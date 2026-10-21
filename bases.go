package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// =====================================================================
// БАЗЫ ЗНАНИЙ (MD-файлы в папке bases/)
// =====================================================================

// =====================================================================
// БАЗЫ ЗНАНИЙ (MD-файлы в папке bases/)
// =====================================================================
//
// Формат файла (frontmatter + markdown):
//
//   ---
//   name: Go
//   description: Краткое описание темы и ключевые слова для роутинга
//   ---
//
//   # Содержимое базы знаний в markdown ...
//
// Алгоритм ответа на вопрос пользователя:
//   1. Из списка тем LLM выбирает наиболее подходящую (или NONE).
//   2. Содержимое выбранного .md подмешивается в system-промпт как контекст.
//   3. LLM отвечает на вопрос, опираясь на контекст базы.

type Base struct {
	Name        string // короткое имя темы (используется для роутинга)
	Description string // описание/ключевые слова (помогает LLM выбрать тему)
	FilePath    string // путь к .md файлу
	Content     string // полное содержимое (без frontmatter)
}

type BaseManager struct {
	mu       sync.RWMutex
	bases    []Base
	dir      string
	loadErrs []string
}

// Загрузить все .md файлы из директории bases/
func NewBaseManager(dir string) *BaseManager {
	bm := &BaseManager{dir: dir}

	entries, err := os.ReadDir(dir)
	if err != nil {
		bm.loadErrs = append(bm.loadErrs, fmt.Sprintf("не удалось прочитать %s: %v", dir, err))
		return bm
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.EqualFold(filepath.Ext(e.Name()), ".md") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		b, err := parseBaseFile(full)
		if err != nil {
			bm.loadErrs = append(bm.loadErrs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		bm.bases = append(bm.bases, b)
	}

	// Стабильный порядок — по имени
	sort.Slice(bm.bases, func(i, j int) bool {
		return bm.bases[i].Name < bm.bases[j].Name
	})

	return bm
}

// Парсит файл: отделяет frontmatter (name, description) от содержимого.
func parseBaseFile(path string) (Base, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Base{}, err
	}
	text := string(data)

	name := ""
	desc := ""
	body := text

	if strings.HasPrefix(strings.TrimLeft(text, "\r\n"), "---") {
		lines := strings.Split(text, "\n")
		start := -1
		end := -1
		for i, ln := range lines {
			t := strings.TrimSpace(ln)
			if t == "---" {
				if start == -1 {
					start = i
				} else {
					end = i
					break
				}
			}
		}
		if start == 0 && end > start {
			for _, ln := range lines[start+1 : end] {
				t := strings.TrimSpace(ln)
				if t == "" {
					continue
				}
				idx := strings.Index(ln, ":")
				if idx <= 0 {
					continue
				}
				key := strings.TrimSpace(ln[:idx])
				val := strings.TrimSpace(ln[idx+1:])
				val = strings.Trim(val, "\"'")
				switch strings.ToLower(key) {
				case "name":
					name = val
				case "description":
					desc = val
				}
			}
			body = strings.Join(lines[end+1:], "\n")
			body = strings.TrimLeft(body, "\r\n")
		}
	}

	if name == "" {
		base := filepath.Base(path)
		name = strings.TrimSuffix(base, filepath.Ext(base))
	}

	return Base{
		Name:        name,
		Description: desc,
		FilePath:    path,
		Content:     body,
	}, nil
}

func (bm *BaseManager) Count() int {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	return len(bm.bases)
}
func (bm *BaseManager) LoadIssues() []string {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	return append([]string(nil), bm.loadErrs...)
}
func (bm *BaseManager) All() []Base {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	return append([]Base(nil), bm.bases...)
}
func (bm *BaseManager) Dir() string { return bm.dir }

func (bm *BaseManager) ListLines() []string {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	out := make([]string, 0, len(bm.bases))
	for _, b := range bm.bases {
		if b.Description != "" {
			out = append(out, fmt.Sprintf("- %s: %s", b.Name, b.Description))
		} else {
			out = append(out, fmt.Sprintf("- %s", b.Name))
		}
	}
	return out
}

// Получить базу по точному имени (без учёта регистра). Возвращает копию.
func (bm *BaseManager) GetByName(name string) *Base {
	name = strings.TrimSpace(name)
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	for i := range bm.bases {
		if strings.EqualFold(bm.bases[i].Name, name) {
			c := bm.bases[i]
			return &c
		}
	}
	return nil
}

// Шаг 1: попросить LLM выбрать наиболее подходящую тему для вопроса.
func (bm *BaseManager) Select(question string, cfg Config) (string, error) {
	if len(bm.bases) == 0 {
		return "", nil
	}

	themes := bm.ListLines()
	system := "Ты — классификатор запросов. Тебе дан список тем и вопрос пользователя.\n" +
		"Твоя задача — выбрать ОДНУ тему из списка, которая лучше всего подходит для ответа на вопрос.\n" +
		"Правила:\n" +
		"- Верни ТОЛЬКО имя темы строго как в списке, без кавычек и пояснений.\n" +
		"- Если ни одна тема не подходит — верни NONE.\n" +
		"- Не придумывай новых тем."

	user := "Список тем:\n" + strings.Join(themes, "\n") +
		"\n\nВопрос пользователя: " + question

	msgs := []ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}

	raw, err := chat(msgs, cfg)
	if err != nil {
		return "", err
	}
	chosen := strings.TrimSpace(raw)
	if i := strings.IndexAny(chosen, "\n\r"); i >= 0 {
		chosen = strings.TrimSpace(chosen[:i])
	}
	chosen = strings.Trim(chosen, "\"'`.,:;!?")

	if chosen == "" || strings.EqualFold(chosen, "NONE") {
		return "", nil
	}
	if bm.GetByName(chosen) == nil {
		return "", nil
	}
	return chosen, nil
}

// Сохранить (создать/перезаписать) MD-файл базы. Сохраняет frontmatter.
func (bm *BaseManager) Save(name, description, content string) (Base, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Base{}, fmt.Errorf("имя не может быть пустым")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return Base{}, fmt.Errorf("недопустимое имя")
	}

	full := filepath.Join(bm.dir, name+".md")

	var body strings.Builder
	if description != "" {
		body.WriteString("---\n")
		body.WriteString("name: " + name + "\n")
		body.WriteString("description: " + description + "\n")
		body.WriteString("---\n\n")
	}
	body.WriteString(strings.TrimLeft(content, "\r\n"))
	body.WriteString("\n")

	if err := os.WriteFile(full, []byte(body.String()), 0644); err != nil {
		return Base{}, err
	}

	b := Base{
		Name:        name,
		Description: description,
		FilePath:    full,
		Content:     strings.TrimLeft(content, "\r\n") + "\n",
	}

	bm.mu.Lock()
	defer bm.mu.Unlock()
	for i := range bm.bases {
		if strings.EqualFold(bm.bases[i].Name, name) {
			bm.bases[i] = b
			return b, nil
		}
	}
	bm.bases = append(bm.bases, b)
	sort.Slice(bm.bases, func(i, j int) bool {
		return bm.bases[i].Name < bm.bases[j].Name
	})
	return b, nil
}

// Удалить MD-файл базы
func (bm *BaseManager) Delete(name string) error {
	name = strings.TrimSpace(name)
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return fmt.Errorf("недопустимое имя")
	}
	bm.mu.Lock()
	defer bm.mu.Unlock()
	var found *Base
	for i := range bm.bases {
		if strings.EqualFold(bm.bases[i].Name, name) {
			found = &bm.bases[i]
			break
		}
	}
	if found == nil {
		return fmt.Errorf("база не найдена: %s", name)
	}
	if err := os.Remove(found.FilePath); err != nil {
		return err
	}
	out := bm.bases[:0]
	for _, x := range bm.bases {
		if !strings.EqualFold(x.Name, name) {
			out = append(out, x)
		}
	}
	bm.bases = out
	return nil
}

// =====================================================================
// ПАРАЛЛЕЛЬНЫЙ АНАЛИЗ БАЗ
// =====================================================================
//
// Для каждой базы отдельной горутиной опрашиваем LLM:
// "Дай КРАТКИЙ ответ (1-3 предложения) на вопрос пользователя,
// опираясь на свою базу. Если вопрос не по твоей теме — верни 'N/A: <причина>'."
//
// Результаты возвращаются в порядке загрузки баз. Поле Chosen выставляется
// вызывающим кодом (после того, как он выберет основную базу).

type BaseAnalysis struct {
	Name        string `json:"name"`        // имя базы
	Description string `json:"description"` // описание
	Answer      string `json:"answer"`      // краткий ответ LLM или "N/A: ..."
	Err         string `json:"err,omitempty"`
	Chosen      bool   `json:"chosen"` // помечается вызывающим
}

// Параллельный опрос всех баз. Возвращает слайс длиной len(bases).
// При ошибке конкретной базы Answer содержит текст ошибки, остальные продолжают.
func (bm *BaseManager) Analyze(question string, cfg Config) []BaseAnalysis {
	bm.mu.RLock()
	if len(bm.bases) == 0 {
		bm.mu.RUnlock()
		return nil
	}
	// Берём snapshot, чтобы цикл не зависел от внешних мутаций.
	snapshot := append([]Base(nil), bm.bases...)
	bm.mu.RUnlock()

	out := make([]BaseAnalysis, len(snapshot))

	// Ограничим параллельность, чтобы не уложить llama-server при большом числе баз
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup

	for i, b := range snapshot {
		wg.Add(1)
		go func(i int, b Base) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ans, err := bm.analyzeOne(b, question, cfg)
			if err != nil {
				out[i] = BaseAnalysis{
					Name:        b.Name,
					Description: b.Description,
					Answer:      "",
					Err:         err.Error(),
				}
				return
			}
			out[i] = BaseAnalysis{
				Name:        b.Name,
				Description: b.Description,
				Answer:      ans,
			}
		}(i, b)
	}

	wg.Wait()
	return out
}

func (bm *BaseManager) analyzeOne(b Base, question string, cfg Config) (string, error) {
	system := fmt.Sprintf(
		"Ты — AI-эксперт по теме «%s». Ниже — твоя база знаний по этой теме.\n\n"+
			"%s\n\n"+
			"Пользователь задал тебе вопрос.\n"+
			"Правила ответа:\n"+
			"- Если вопрос относится к твоей теме и в базе есть ответ — дай КРАТКИЙ ответ (1-3 предложения), опираясь на базу.\n"+
			"- Если вопрос НЕ относится к твоей теме — верни ровно одну строку: N/A: <кратко, почему не по теме>\n"+
			"- Не выдумывай факты, которых нет в базе.",
		b.Name, b.Content)

	msgs := []ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: question},
	}

	raw, err := chat(msgs, cfg)
	if err != nil {
		return "", err
	}
	ans := strings.TrimSpace(raw)
	// усечём до ~600 символов чтобы UI оставался лёгким
	if len(ans) > 800 {
		ans = ans[:800] + "…"
	}
	return ans, nil
}

// Является ли ответ «нерелевантным» (LLM сама пометила N/A)
func (a *BaseAnalysis) IsNA() bool {
	s := strings.TrimSpace(a.Answer)
	return strings.HasPrefix(strings.ToUpper(s), "N/A:") || strings.HasPrefix(s, "N/A ")
}
