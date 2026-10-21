---
name: Bash
description: Командная оболочка Bash и утилиты Linux: переменные, условия, циклы, функции, пайпы, перенаправления, grep, awk, sed, find, xargs, cron, systemd, права доступа, ssh, tmux.
---

# Bash

## Базовый синтаксис
- Комментарии: `#`
- Переменные: `NAME=value`, обращение `$NAME` или `${NAME}`
- Экспорт: `export PATH=$PATH:/opt/bin`

## Условия
```bash
if [ -f "$file" ]; then
    echo "файл есть"
elif [ -d "$file" ]; then
    echo "директория"
else
    echo "нет"
fi
```

## Циклы
```bash
for f in *.txt; do echo "$f"; done
while read line; do echo "$line"; done < input.txt
```

## Функции
```bash
greet() {
    local name=$1
    echo "Hello, $name"
}
greet "world"
```

## Пайпы и перенаправления
- `|` — пайп
- `>`, `>>` — запись/добавление в файл
- `<` — чтение из файла
- `2>&1` — stderr в stdout

## Полезные команды
- `grep -r "pattern" .` — поиск по содержимому
- `find . -name "*.go"` — поиск файлов
- `sed -i 's/foo/bar/g' file` — замена
- `awk '{print $1}' file` — обработка колонок
- `xargs` — построение команд из stdin
- `cut`, `sort`, `uniq`, `wc`, `head`, `tail`

## Права доступа
- `chmod 755 script.sh` — числовой режим (rwx для владельца)
- `chown user:group file` — смена владельца
- `ls -la` — подробный список

## Cron
```cron
# каждую минуту
* * * * * /path/to/script.sh

# каждый день в 3:00
0 3 * * * /path/to/backup.sh
```

## SSH
- `ssh user@host`
- Ключи: `ssh-keygen -t ed25519`, копирование `ssh-copy-id user@host`
- Конфиг: `~/.ssh/config`

## tmux
- `tmux new -s name` — новая сессия
- `Ctrl-b d` — отсоединиться
- `tmux attach -t name` — подключиться
