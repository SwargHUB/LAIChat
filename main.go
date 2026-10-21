package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
// КОНФИГУРАЦИЯ
// =====================================================================

type Config struct {
	// Путь к исполняемому файлу llama-server (серверный режим).
	// Скачать: https://github.com/ggml-org/llama.cpp/releases
	LlamaBinary string

	// Путь к .gguf модели.
	ModelPath string

	// Параметры генерации
	ContextSize int
	Threads     int
	MaxTokens   int
	Temperature float64
	TopP        float64

	// Сервер
	ServerHost string
	ServerPort int

	// Автозапуск сервера из чата
	AutoStartServer bool
}

// Загрузить конфиг (с дефолтами)
func loadConfig() Config {
	cfg := Config{
		ContextSize:    4096,
		Threads:        runtime.NumCPU(),
		MaxTokens:      512,
		Temperature:    0.7,
		TopP:           0.9,
		ServerHost:     "127.0.0.1",
		ServerPort:     8080,
		AutoStartServer: true,
	}

	// Ищем llama-server рядом с исполняемым файлом чата
	exeDir := getExecutableDir()
	cfg.LlamaBinary = filepath.Join(exeDir, "bin", "llama-server")

	// Под Windows добавляем .exe
	if runtime.GOOS == "windows" {
		cfg.LlamaBinary += ".exe"
	}

	// Ищем модель в ./models/
	cfg.ModelPath = filepath.Join(exeDir, "models", "model.gguf")

	// Переменные окружения имеют приоритет
	if v := os.Getenv("LLAMA_BINARY"); v != "" {
		cfg.LlamaBinary = v
	}
	if v := os.Getenv("LLAMA_MODEL"); v != "" {
		cfg.ModelPath = v
	}
	if v := os.Getenv("LLAMA_HOST"); v != "" {
		cfg.ServerHost = v
	}
	if v := os.Getenv("LLAMA_PORT"); v != "" {
		fmt.Sscanf(v, "%d", &cfg.ServerPort)
	}
	if v := os.Getenv("LLAMA_NO_AUTOSTART"); v == "1" {
		cfg.AutoStartServer = false
	}

	return cfg
}

// Получить директорию где лежит исполняемый файл чата
func getExecutableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if runtime.GOOS != "windows" {
		// Разрешаем символические ссылки
		real, err := filepath.EvalSymlinks(exe)
		if err == nil {
			exe = real
		}
	}
	return filepath.Dir(exe)
}

// =====================================================================
// СТРУКТУРЫ ДЛЯ CHAT COMPLETION (OpenAI-совместимый формат)
// =====================================================================

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type LlamaRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Stream      bool          `json:"stream"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
	TopP        float64       `json:"top_p,omitempty"`
}

type LlamaChoice struct {
	Message ChatMessage `json:"message"`
}

type LlamaResponse struct {
	Choices []LlamaChoice `json:"choices"`
}

// =====================================================================
// УПРАВЛЕНИЕ СЕРВЕРОМ LLAMA.CPP
// =====================================================================

type ServerManager struct {
	cmd        *exec.Cmd
	cfg        Config
	serverURL  string
	mu         sync.Mutex
	isRunning  bool
	isStarting bool
}

// Проверить, отвечает ли сервер
func (sm *ServerManager) isHealthy() bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(sm.serverURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// Запустить сервер
func (sm *ServerManager) Start() error {
	sm.mu.Lock()
	if sm.isRunning || sm.isStarting {
		sm.mu.Unlock()
		return nil
	}
	sm.isStarting = true
	sm.mu.Unlock()

	if sm.isHealthy() {
		sm.mu.Lock()
		sm.isRunning = true
		sm.isStarting = false
		sm.mu.Unlock()
		return nil
	}

	// Проверяем что бинарь существует
	if _, err := os.Stat(sm.cfg.LlamaBinary); err != nil {
		return fmt.Errorf("не найден llama-server: %s\n"+
			"   Скачай с https://github.com/ggml-org/llama.cpp/releases\n"+
			"   Положи в ./bin/llama-server (без .exe) или ./bin/llama-server.exe", sm.cfg.LlamaBinary)
	}

	// Проверяем что модель существует
	if _, err := os.Stat(sm.cfg.ModelPath); err != nil {
		return fmt.Errorf("не найдена модель: %s\n"+
			"   Скачай .gguf модель с https://huggingface.co/TheBloke\n"+
			"   Положи в ./models/model.gguf", sm.cfg.ModelPath)
	}

	fmt.Println("Запускаю llama-server...")
	fmt.Printf("  Бинарь: %s\n", sm.cfg.LlamaBinary)
	fmt.Printf("  Модель: %s\n", sm.cfg.ModelPath)
	fmt.Printf("  Порт: %s:%d\n", sm.cfg.ServerHost, sm.cfg.ServerPort)

	args := []string{
		"-m", sm.cfg.ModelPath,
		"-c", fmt.Sprintf("%d", sm.cfg.ContextSize),
		"-t", fmt.Sprintf("%d", sm.cfg.Threads),
		"--host", sm.cfg.ServerHost,
		"--port", fmt.Sprintf("%d", sm.cfg.ServerPort),
	}

	cmd := exec.Command(sm.cfg.LlamaBinary, args...)

	// Логи сервера пишем в файл
	logFile := filepath.Join(getExecutableDir(), "llama-server.log")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		cmd.Stdout = f
		cmd.Stderr = f
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}

	if err := cmd.Start(); err != nil {
		sm.mu.Lock()
		sm.isStarting = false
		sm.mu.Unlock()
		return fmt.Errorf("запуск: %w", err)
	}

	sm.cmd = cmd
	fmt.Println("Жду готовности сервера (до 60 сек)...")

	// Ждём готовности
	deadline := time.Now().Add(60 * time.Second)
	dots := 0
	for time.Now().Before(deadline) {
		if sm.isHealthy() {
			sm.mu.Lock()
			sm.isRunning = true
			sm.isStarting = false
			sm.mu.Unlock()
			fmt.Println("\n✓ llama-server готов")
			return nil
		}
		// Проверяем что процесс не умер
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			sm.mu.Lock()
			sm.isStarting = false
			sm.mu.Unlock()
			return fmt.Errorf("сервер завершился сразу после запуска. Смотри лог: %s", logFile)
		}
		fmt.Print(".")
		dots++
		if dots%30 == 0 {
			fmt.Println()
		}
		time.Sleep(1 * time.Second)
	}

	cmd.Process.Kill()
	cmd.Wait()
	sm.mu.Lock()
	sm.isStarting = false
	sm.mu.Unlock()
	return fmt.Errorf("сервер не ответил за 60 сек. Смотри лог: %s", logFile)
}

// Остановить сервер
func (sm *ServerManager) Stop() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if sm.cmd != nil && sm.cmd.Process != nil {
		// Посылаем SIGTERM, чтобы сервер корректно завершился
		if runtime.GOOS != "windows" {
			sm.cmd.Process.Signal(os.Interrupt)
			done := make(chan struct{})
			go func() {
				sm.cmd.Wait()
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				sm.cmd.Process.Kill()
			}
		} else {
			sm.cmd.Process.Kill()
			sm.cmd.Wait()
		}
		fmt.Println("llama-server остановлен")
	}
	sm.isRunning = false
}

// =====================================================================
// ОДИН ЗАПРОС К СЕРВЕРУ
// =====================================================================

func chat(messages []ChatMessage, cfg Config) (string, error) {
	// llama-server принимает любое значение model (или пусто)
	// Используем имя файла модели без расширения
	modelName := strings.TrimSuffix(filepath.Base(cfg.ModelPath), filepath.Ext(cfg.ModelPath))

	reqBody := LlamaRequest{
		Model:       modelName,
		Messages:    messages,
		Stream:      false,
		MaxTokens:   cfg.MaxTokens,
		Temperature: cfg.Temperature,
		TopP:        cfg.TopP,
	}

	jsonData, _ := json.Marshal(reqBody)

	url := fmt.Sprintf("http://%s:%d/v1/chat/completions", cfg.ServerHost, cfg.ServerPort)

	client := &http.Client{Timeout: 120 * time.Second}
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API %d: %s", resp.StatusCode, string(body))
	}

	var llamaResp LlamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&llamaResp); err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}

	if len(llamaResp.Choices) == 0 {
		return "", fmt.Errorf("пустой ответ")
	}

	return llamaResp.Choices[0].Message.Content, nil
}

// =====================================================================
// MAIN
// =====================================================================

func main() {
	cliMode := false
	webPort := 8765
	webHost := "127.0.0.1"
	noOpen := false

	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch a {
		case "-cli", "--cli":
			cliMode = true
		case "-web", "--web":
			cliMode = false
		case "-no-open", "--no-open":
			noOpen = true
		case "-h", "-help", "--help":
			fmt.Println("Использование: go-chat-local [опции]")
			fmt.Println("  (по умолчанию — веб-интерфейс в браузере)")
			fmt.Println("  -cli           запустить терминальный чат")
			fmt.Println("  -web           запустить веб-интерфейс (по умолчанию)")
			fmt.Println("  -port N        порт веб-сервера (по умолчанию 8765)")
			fmt.Println("  -host ADDR     адрес веб-сервера (по умолчанию 127.0.0.1)")
			fmt.Println("  -no-open       не открывать браузер автоматически")
			fmt.Println("  -h, -help      эта справка")
			return
		}
		if strings.HasPrefix(a, "-port=") {
			fmt.Sscanf(a[len("-port="):], "%d", &webPort)
			continue
		}
		if a == "-port" || a == "--port" {
			if i+1 < len(args) {
				i++
				fmt.Sscanf(args[i], "%d", &webPort)
			}
			continue
		}
		if strings.HasPrefix(a, "-host=") {
			webHost = a[len("-host="):]
			continue
		}
		if a == "-host" || a == "--host" {
			if i+1 < len(args) {
				i++
				webHost = args[i]
			}
			continue
		}
	}

	if cliMode {
		runCLI()
		return
	}
	runWeb(webHost, webPort, !noOpen)
}

func runCLI() {
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║   Локальный AI чат (Go + llama.cpp)     ║")
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()

	cfg := loadConfig()
	sm := &ServerManager{
		cfg:       cfg,
		serverURL: fmt.Sprintf("http://%s:%d", cfg.ServerHost, cfg.ServerPort),
	}

	// Если сервер уже запущен — используем
	if sm.isHealthy() {
		fmt.Println("✓ llama-server уже запущен на", sm.serverURL)
		sm.isRunning = true
	} else if cfg.AutoStartServer {
		// Пытаемся запустить сами
		if err := sm.Start(); err != nil {
			fmt.Println()
			fmt.Println("⚠ Не удалось запустить сервер автоматически:", err)
			fmt.Println()
			fmt.Println("Варианты:")
			fmt.Println("1. Запустите вручную в другом терминале:")
			fmt.Printf("   %s -m %s --port %d\n\n", cfg.LlamaBinary, cfg.ModelPath, cfg.ServerPort)
			fmt.Println("2. Затем перезапустите чат.")
			fmt.Println()
			fmt.Println("Установите LLAMA_NO_AUTOSTART=1 чтобы отключить автозапуск.")
			os.Exit(1)
		}
	} else {
		fmt.Println("Автозапуск отключён (LLAMA_NO_AUTOSTART=1).")
		fmt.Println("Запустите вручную:")
		fmt.Printf("  %s -m %s --port %d\n", cfg.LlamaBinary, cfg.ModelPath, cfg.ServerPort)
		fmt.Println()
		fmt.Println("Затем нажмите Enter чтобы продолжить, или Ctrl+C для выхода.")
		bufio.NewReader(os.Stdin).ReadString('\n')
	}

	// Останавливаем сервер при выходе (только если мы его запускали)
	defer func() {
		if cfg.AutoStartServer {
			sm.Stop()
		}
	}()

	fmt.Println()
	fmt.Println("Модель:", filepath.Base(cfg.ModelPath))
	fmt.Println("Контекст:", cfg.ContextSize, "токенов")
	fmt.Println("Потоки CPU:", cfg.Threads)
	fmt.Println("Сервер:", sm.serverURL)

	// Загружаем базы знаний
	basesDir := filepath.Join(getExecutableDir(), "bases")
	bm := NewBaseManager(basesDir)
	fmt.Printf("Базы знаний: %d (папка %s)\n", bm.Count(), basesDir)
	for _, ln := range bm.ListLines() {
		fmt.Println("  " + ln)
	}
	for _, w := range bm.LoadIssues() {
		fmt.Println("  ⚠ " + w)
	}
	fmt.Println()
	fmt.Println("Команды:")
	fmt.Println("  exit/quit — выход")
	fmt.Println("  clear    — очистить историю")
	fmt.Println("  cfg      — показать настройки")
	fmt.Println("  bases    — список баз знаний")
	fmt.Println("  reload   — перечитать базы из папки bases/")
	fmt.Println("  restart  — перезапустить сервер")
	fmt.Println(strings.Repeat("─", 60))

	history := []ChatMessage{
		{
			Role:    "system",
			Content: "Ты полезный AI-ассистент. Отвечай кратко и по делу. Если не знаешь — скажи честно.\n" +
				"Если в контексте ниже передана база знаний — опирайся на неё и не придумывай факты, которых в ней нет.",
		},
	}

	reader := bufio.NewReader(os.Stdin)

	for {
		fmt.Print("\nВы: ")
		input, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			log.Printf("Ошибка ввода: %v", err)
			break
		}

		input = strings.TrimSpace(input)
		if input == "" {
			continue
		}

		switch input {
		case "exit", "quit":
			fmt.Println("Пока!")
			return
		case "clear":
			history = history[:1]
			fmt.Println("История очищена.")
			continue
		case "cfg", "config":
			fmt.Printf("\nМодель: %s\nСервер: %s\nКонтекст: %d\nПотоки: %d\nТемпература: %.2f\nMaxTokens: %d\nБинарь: %s\nБазы: %d (%s)\n",
				cfg.ModelPath, sm.serverURL, cfg.ContextSize, cfg.Threads, cfg.Temperature, cfg.MaxTokens, cfg.LlamaBinary, bm.Count(), basesDir)
			continue
		case "bases":
			if bm.Count() == 0 {
				fmt.Printf("\nНет загруженных баз. Положи .md файлы в %s\n", basesDir)
			} else {
				fmt.Printf("\nЗагружено баз: %d\n", bm.Count())
				for _, b := range bm.All() {
					fmt.Printf("  • %s — %s\n    %s\n", b.Name, b.FilePath, b.Description)
				}
			}
			continue
		case "reload":
			bm = NewBaseManager(basesDir)
			fmt.Printf("Перечитано баз: %d\n", bm.Count())
			for _, w := range bm.LoadIssues() {
				fmt.Println("  ⚠ " + w)
			}
			continue
		case "restart":
			if cfg.AutoStartServer {
				sm.Stop()
				if err := sm.Start(); err != nil {
					fmt.Printf("Ошибка: %v\n", err)
				}
			} else {
				fmt.Println("Автозапуск отключён, перезапустите сервер вручную.")
			}
			continue
		}

		history = append(history, ChatMessage{
			Role:    "user",
			Content: input,
		})

		// Шаг 1: параллельный анализ всех баз + выбор основной
		var baseCtx ChatMessage
		var chosenName string
		var analyses []BaseAnalysis
		if bm.Count() > 0 {
			fmt.Printf("\n[1/3 параллельный анализ %d баз… ", bm.Count())
			analyses = bm.Analyze(input, cfg)
			fmt.Print("готово]\n[2/3 выбираю лучшую… ")
			name, err := bm.Select(input, cfg)
			if err != nil {
				fmt.Printf("ошибка: %v]\n", err)
			} else if name != "" {
				chosenName = name
			}
			// Если классификатор не выбрал — возьмём первую не-N/A базу
			if chosenName == "" {
				for _, an := range analyses {
					if !an.IsNA() {
						chosenName = an.Name
						break
					}
				}
			}
			// Помечаем выбранную
			for i := range analyses {
				analyses[i].Chosen = analyses[i].Name == chosenName
			}
			fmt.Printf("→ %s]\n[3/3 генерирую ответ… ", chosenName)
		} else {
			fmt.Print("\nAI: ")
		}

		// Собираем сообщения для запроса: история + контекст основной базы + сводка остальных
		msgs := make([]ChatMessage, 0, len(history)+2)
		msgs = append(msgs, history[:len(history)-1]...)
		if chosenName != "" {
			b := bm.GetByName(chosenName)
			if b != nil {
				other := buildOtherHints(chosenName, analyses)
				baseCtx = ChatMessage{
					Role: "system",
					Content: fmt.Sprintf(
						"Используй следующую базу знаний по теме «%s» как ОСНОВНОЙ источник фактов. "+
							"Если в ней нет ответа — так и скажи.\n\n## База «%s»\n%s%s",
						b.Name, b.Name, b.Content, other),
				}
				msgs = append(msgs, baseCtx)
			}
		}
		msgs = append(msgs, history[len(history)-1])

		response, err := chatWithRetry(msgs, cfg, 3)
		if err != nil {
			fmt.Printf("Ошибка: %v\n", err)
			history = history[:len(history)-1]
			continue
		}

		fmt.Println()
		fmt.Println(response)
		if chosenName != "" {
			fmt.Printf("  (источник: bases/%s.md)\n", strings.ToLower(chosenName))
		}
		// Краткий параллельный анализ в CLI
		if len(analyses) > 1 {
			fmt.Println("  ── параллельный анализ ──")
			for _, a := range analyses {
				if a.Err != "" {
					fmt.Printf("   · %s — ошибка: %s\n", a.Name, a.Err)
				} else if a.IsNA() {
					fmt.Printf("   · %s — %s\n", a.Name, a.Answer)
				} else {
					short := a.Answer
					if len(short) > 160 {
						short = short[:160] + "…"
					}
					mark := "  "
					if a.Chosen {
						mark = "✓ "
					}
					fmt.Printf("   %s%s → %s\n", mark, a.Name, short)
				}
			}
		}

		history = append(history, ChatMessage{
			Role:    "assistant",
			Content: response,
		})
	}
}

// Запрос с retry (если сервер ещё поднимается)
func chatWithRetry(messages []ChatMessage, cfg Config, maxAttempts int) (string, error) {
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		text, err := chat(messages, cfg)
		if err == nil {
			return text, nil
		}
		lastErr = err
		// Если ошибка соединения — возможно сервер ещё не поднялся
		if strings.Contains(err.Error(), "connection refused") ||
			strings.Contains(err.Error(), "EOF") {
			if i < maxAttempts-1 {
				fmt.Print(" ⏳")
				time.Sleep(3 * time.Second)
				continue
			}
		}
		return "", err
	}
	return "", lastErr
}
