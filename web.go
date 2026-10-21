package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// =====================================================================
// ВЕБ-ИНТЕРФЕЙС
// =====================================================================
//
// Поднимает локальный HTTP-сервер, отдаёт статику (HTML/JS/CSS) и API.
// По умолчанию открывает страницу в браузере.
//
// Эндпоинты:
//   GET  /                      — UI
//   GET  /api/state             — конфиг, статус сервера, список баз
//   POST /api/config            — изменить настройки (ctx, threads, maxTokens, temp, topP)
//   POST /api/restart           — перезапустить llama-server (no-op если LLAMA_NO_AUTOSTART=1)
//   POST /api/clear             — очистить историю чата
//   GET  /api/bases             — список баз с путями
//   GET  /api/bases/{name}      — содержимое базы (description + content)
//   PUT  /api/bases/{name}      — сохранить базу (json: {description, content})
//   POST /api/bases             — создать базу (json: {name, description, content})
//   DELETE /api/bases/{name}    — удалить базу
//   POST /api/reload            — перечитать базы из папки
//   POST /api/chat              — отправить сообщение (json: {message}) — возвращает {response, source}
//
// Хранилище настроек: settings.json рядом с exe (для UI-настроек, не путать с LLAMA_* env).

//go:embed static
var staticFS embed.FS

type Settings struct {
	ContextSize int     `json:"context_size"`
	Threads     int     `json:"threads"`
	MaxTokens   int     `json:"max_tokens"`
	Temperature float64 `json:"temperature"`
	TopP        float64 `json:"top_p"`
}

func loadSettings(path string) Settings {
	s := Settings{
		ContextSize: 4096,
		Threads:     runtime.NumCPU(),
		MaxTokens:   512,
		Temperature: 0.7,
		TopP:        0.9,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	_ = json.Unmarshal(data, &s)
	return s
}

func saveSettings(path string, s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

type WebApp struct {
	mu          sync.Mutex
	cfg         Config
	sm          *ServerManager
	bm          *BaseManager
	basesDir    string
	settings    Settings
	settingsPath string
	history     []ChatMessage
}

func NewWebApp(cfg Config) *WebApp {
	exeDir := getExecutableDir()
	basesDir := filepath.Join(exeDir, "bases")
	settingsPath := filepath.Join(exeDir, "settings.json")

	s := loadSettings(settingsPath)
	// Применяем пользовательские настройки поверх cfg (если валидны)
	if s.ContextSize > 0 {
		cfg.ContextSize = s.ContextSize
	}
	if s.Threads > 0 {
		cfg.Threads = s.Threads
	}
	if s.MaxTokens > 0 {
		cfg.MaxTokens = s.MaxTokens
	}
	if s.Temperature > 0 {
		cfg.Temperature = s.Temperature
	}
	if s.TopP > 0 {
		cfg.TopP = s.TopP
	}

	sm := &ServerManager{
		cfg:       cfg,
		serverURL: fmt.Sprintf("http://%s:%d", cfg.ServerHost, cfg.ServerPort),
	}
	bm := NewBaseManager(basesDir)

	return &WebApp{
		cfg:          cfg,
		sm:           sm,
		bm:           bm,
		basesDir:     basesDir,
		settings:     s,
		settingsPath: settingsPath,
		history: []ChatMessage{
			{
				Role: "system",
				Content: "Ты полезный AI-ассистент. Отвечай кратко и по делу. Если не знаешь — скажи честно.\n" +
					"Если в контексте ниже передана база знаний — опирайся на неё и не придумывай факты, которых в ней нет.",
			},
		},
	}
}

func runWeb(host string, port int, openBrowser bool) {
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║   Go Chat Local — веб-интерфейс         ║")
	fmt.Println("╚══════════════════════════════════════════╝")

	app := NewWebApp(loadConfig())

	if app.sm.isHealthy() {
		fmt.Println("✓ llama-server уже запущен на", app.sm.serverURL)
		app.sm.isRunning = true
	} else if app.cfg.AutoStartServer {
		if err := app.sm.Start(); err != nil {
			fmt.Println()
			fmt.Println("⚠ Не удалось запустить сервер автоматически:", err)
			fmt.Println("Запустите его вручную, либо откройте UI и нажмите «Перезапустить сервер».")
		}
	} else {
		fmt.Println("Автозапуск отключён. UI работает, но без живой модели чат не отвечает.")
	}

	defer func() {
		if app.cfg.AutoStartServer {
			app.sm.Stop()
		}
	}()

	addr := fmt.Sprintf("%s:%d", host, port)
	mux := http.NewServeMux()
	app.registerRoutes(mux)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	url := "http://" + addr
	fmt.Println()
	fmt.Println("UI:", url)
	fmt.Println("API: /api/state, /api/chat, /api/bases, /api/config")
	fmt.Println()
	fmt.Println("Ctrl+C — выход")

	if openBrowser {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openInBrowser(url)
		}()
	}

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Println("Ошибка сервера:", err)
		os.Exit(1)
	}
}

func (a *WebApp) registerRoutes(mux *http.ServeMux) {
	// Статика
	sub, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	// API
	mux.HandleFunc("/api/state", a.handleState)
	mux.HandleFunc("/api/config", a.handleConfig)
	mux.HandleFunc("/api/clear", a.handleClear)
	mux.HandleFunc("/api/restart", a.handleRestart)
	mux.HandleFunc("/api/reload", a.handleReload)
	mux.HandleFunc("/api/chat", a.handleChat)

	// /api/bases, /api/bases/{name}, /api/bases/{name} с разными методами
	mux.HandleFunc("/api/bases", a.handleBasesCollection)
	mux.HandleFunc("/api/bases/", a.handleBasesItem)
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err string) {
	writeJSON(w, status, map[string]string{"error": err})
}

// ---------- handlers ----------

func (a *WebApp) handleState(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	bases := make([]map[string]string, 0, len(a.bm.All()))
	for _, b := range a.bm.All() {
		bases = append(bases, map[string]string{
			"name":        b.Name,
			"description": b.Description,
			"path":        b.FilePath,
		})
	}
	writeJSON(w, 200, map[string]interface{}{
		"server": map[string]interface{}{
			"host":           a.cfg.ServerHost,
			"port":           a.cfg.ServerPort,
			"url":            a.sm.serverURL,
			"running":        a.sm.isRunning,
			"healthy":        a.sm.isHealthy(),
			"auto_start":     a.cfg.AutoStartServer,
		},
		"model": map[string]interface{}{
			"path": a.cfg.ModelPath,
			"name": filepath.Base(a.cfg.ModelPath),
		},
		"settings":     a.settings,
		"bases_dir":    a.basesDir,
		"bases":        bases,
		"load_issues":  a.bm.LoadIssues(),
		"history_len":  len(a.history) - 1, // без system
	})
}

func (a *WebApp) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var s Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeErr(w, 400, "неверный JSON")
		return
	}
	// Валидация
	if s.ContextSize < 128 || s.ContextSize > 32768 {
		writeErr(w, 400, "context_size должен быть от 128 до 32768")
		return
	}
	if s.Threads < 1 || s.Threads > 256 {
		writeErr(w, 400, "threads должен быть от 1 до 256")
		return
	}
	if s.MaxTokens < 1 || s.MaxTokens > 8192 {
		writeErr(w, 400, "max_tokens должен быть от 1 до 8192")
		return
	}
	if s.Temperature < 0 || s.Temperature > 2 {
		writeErr(w, 400, "temperature должен быть от 0 до 2")
		return
	}
	if s.TopP < 0 || s.TopP > 1 {
		writeErr(w, 400, "top_p должен быть от 0 до 1")
		return
	}

	a.mu.Lock()
	a.settings = s
	a.cfg.ContextSize = s.ContextSize
	a.cfg.Threads = s.Threads
	a.cfg.MaxTokens = s.MaxTokens
	a.cfg.Temperature = s.Temperature
	a.cfg.TopP = s.TopP
	a.sm.cfg = a.cfg
	_ = saveSettings(a.settingsPath, s)
	a.mu.Unlock()

	writeJSON(w, 200, map[string]interface{}{"ok": true, "settings": s})
}

func (a *WebApp) handleClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	a.mu.Lock()
	a.history = a.history[:1]
	a.mu.Unlock()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *WebApp) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.cfg.AutoStartServer {
		writeErr(w, 400, "автозапуск отключён (LLAMA_NO_AUTOSTART=1)")
		return
	}
	a.sm.Stop()
	if err := a.sm.Start(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *WebApp) handleReload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	a.mu.Lock()
	a.bm = NewBaseManager(a.basesDir)
	a.mu.Unlock()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *WebApp) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var req struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "неверный JSON")
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		writeErr(w, 400, "пустое сообщение")
		return
	}

	// 1. Захватываем историю под мьютексом
	a.mu.Lock()
	a.history = append(a.history, ChatMessage{Role: "user", Content: msg})

	// Берём срез истории и копию BaseManager (он потокобезопасен для чтения)
	bm := a.bm
	cfg := a.cfg
	historyCopy := append([]ChatMessage(nil), a.history...)
	a.mu.Unlock()

	// 2. Параллельный анализ по всем базам (если есть)
	var analyses []BaseAnalysis
	if bm.Count() > 0 {
		analyses = bm.Analyze(msg, cfg)
	}

	// 3. Выбор основной базы: пробуем Select(), иначе берём первую не-N/A
	chosenName := ""
	if bm.Count() > 0 {
		if name, err := bm.Select(msg, cfg); err == nil && name != "" {
			chosenName = name
		}
	}
	if chosenName == "" {
		for _, an := range analyses {
			if !an.IsNA() {
				chosenName = an.Name
				break
			}
		}
	}

	// 4. Помечаем выбранную
	for i := range analyses {
		analyses[i].Chosen = analyses[i].Name == chosenName
	}

	// 5. Собираем финальный контекст: база + сводка ответов из других баз
	var msgs []ChatMessage
	msgs = append(msgs, historyCopy[:len(historyCopy)-1]...)

	if chosenName != "" {
		b := bm.GetByName(chosenName)
		if b != nil {
			otherHints := buildOtherHints(chosenName, analyses)
			systemContent := fmt.Sprintf(
				"Используй следующую базу знаний по теме «%s» как ОСНОВНОЙ источник фактов. "+
					"Если в ней нет ответа — так и скажи.\n\n## База «%s»\n%s%s",
				b.Name, b.Name, b.Content, otherHints)
			msgs = append(msgs, ChatMessage{Role: "system", Content: systemContent})
		}
	}
	msgs = append(msgs, historyCopy[len(historyCopy)-1])

	// 6. LLM-вызов (долгий) — вне мьютекса
	response, err := chatWithRetry(msgs, cfg, 3)
	if err != nil {
		a.mu.Lock()
		a.history = a.history[:len(a.history)-1]
		a.mu.Unlock()
		writeErr(w, 500, err.Error())
		return
	}

	a.mu.Lock()
	a.history = append(a.history, ChatMessage{Role: "assistant", Content: response})
	a.mu.Unlock()

	writeJSON(w, 200, map[string]interface{}{
		"response": response,
		"source":   chosenName,
		"analyses": analyses,
	})
}

// Сводка не-N/A ответов других баз — подмешивается в финальный system-промпт,
// чтобы LLM могла сама порекомендовать «взять другой раздел».
func buildOtherHints(chosenName string, analyses []BaseAnalysis) string {
	var hints []string
	for _, a := range analyses {
		if a.Name == chosenName {
			continue
		}
		if a.Err != "" || a.IsNA() {
			continue
		}
		ans := strings.TrimSpace(a.Answer)
		if ans == "" {
			continue
		}
		hints = append(hints, fmt.Sprintf("- %s: %s", a.Name, ans))
	}
	if len(hints) == 0 {
		return ""
	}
	return "\n\n## Сводка ответов из других баз\n" +
		"Если одна из этих баз на самом деле релевантнее основной — упомяни это в ответе и предложи пользователю обратиться именно к ней.\n" +
		strings.Join(hints, "\n")
}

// /api/bases  (POST — создать)
func (a *WebApp) handleBasesCollection(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		a.mu.Lock()
		bases := a.bm.All()
		a.mu.Unlock()
		out := make([]map[string]string, 0, len(bases))
		for _, b := range bases {
			out = append(out, map[string]string{
				"name": b.Name, "description": b.Description, "path": b.FilePath,
			})
		}
		writeJSON(w, 200, out)
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Content     string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "неверный JSON")
		return
	}
	a.mu.Lock()
	b, err := a.bm.Save(req.Name, req.Description, req.Content)
	a.mu.Unlock()
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"name": b.Name, "path": b.FilePath})
}

// /api/bases/{name}
func (a *WebApp) handleBasesItem(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/bases/")
	name = strings.Trim(name, "/")
	if name == "" {
		writeErr(w, 400, "не указано имя")
		return
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		writeErr(w, 400, "недопустимое имя")
		return
	}

	switch r.Method {
	case http.MethodGet:
		a.mu.Lock()
		b := a.bm.GetByName(name)
		a.mu.Unlock()
		if b == nil {
			writeErr(w, 404, "не найдено")
			return
		}
		writeJSON(w, 200, map[string]string{
			"name":        b.Name,
			"description": b.Description,
			"content":     b.Content,
			"path":        b.FilePath,
		})

	case http.MethodPut:
		var req struct {
			Description string `json:"description"`
			Content     string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, "неверный JSON")
			return
		}
		a.mu.Lock()
		_, err := a.bm.Save(name, req.Description, req.Content)
		a.mu.Unlock()
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})

	case http.MethodDelete:
		a.mu.Lock()
		err := a.bm.Delete(name)
		a.mu.Unlock()
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})

	default:
		writeErr(w, 405, "method not allowed")
	}
}

// ---------- browser ----------

func openInBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// helper для проверки занятости порта (не используется, оставлен на всякий случай)
func isPortFree(addr string) bool {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}
