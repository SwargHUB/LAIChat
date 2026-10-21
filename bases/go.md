---
name: Go
description: Язык программирования Go (Golang): синтаксис, горутины, каналы, пакеты, модули go mod, интерфейсы, стандартная библиотека, сборка, тестирование, кросс-компиляция.
---

# Go (Golang)

## Установка
- Скачать с https://go.dev/dl/
- Проверка: `go version`
- Переменные окружения: `GOROOT`, `GOPATH`, `PATH`

## Базовый синтаксис
- Файлы с расширением `.go`, пакет объявляется через `package`
- Точка входа: `func main()`
- Импорт: `import "fmt"` или группа `import ( ... )`
- Переменные: `var x int`, `x := 10` (короткая форма только внутри функций)

## Горутины и каналы
```go
go func() {
    fmt.Println("в горутине")
}()

ch := make(chan int)
ch <- 1
v := <-ch
close(ch)
```

- `sync.WaitGroup` для ожидания завершения группы горутин
- `select` для ожидания нескольких каналов

## Модули
- `go mod init example.com/myapp`
- `go mod tidy` — подтянуть зависимости
- `go build`, `go run .`, `go test ./...`

## Интерфейсы
- Неявная реализация (duck typing)
- Пустой интерфейс `interface{}` / `any` — принимает любое значение

## Полезные пакеты stdlib
- `fmt`, `os`, `io`, `bufio`, `strings`, `strconv`
- `net/http` — HTTP-клиент и сервер
- `encoding/json` — работа с JSON
- `time`, `context`, `sync`, `errors`
- `log/slog` — структурированное логирование (Go 1.21+)

## Тестирование
- Файлы `*_test.go`
- `func TestXxx(t *testing.T)`, `t.Run`, `t.Errorf`
- Бенчмарки: `func BenchmarkXxx(b *testing.B)`

## Сборка под другую ОС/архитектуру
```
GOOS=linux GOARCH=amd64 go build -o app-linux .
```
