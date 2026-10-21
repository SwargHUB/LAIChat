---
name: Python
description: Язык программирования Python: синтаксис, типы данных, list/dict/set, comprehensions, генераторы, декораторы, классы, asyncio, pip, venv, виртуальные окружения, pytest.
---

# Python

## Установка и версии
- Скачать с https://www.python.org/downloads/
- Менеджер версий: `pyenv`
- Проверка: `python --version`, `python3 --version`

## Виртуальные окружения
```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate
pip install requests
deactivate
```

## Базовый синтаксис
- Отступы вместо фигурных скобок (4 пробела)
- Комментарии: `#`, многострочные — тройные кавычки `"""..."""`
- `print("hello")`, `input("name: ")`

## Типы данных
- `int`, `float`, `str`, `bool`, `None`
- Коллекции: `list`, `tuple`, `dict`, `set`
- Проверка типа: `isinstance(x, int)`

## Comprehensions
```python
squares = [x*x for x in range(10)]
evens = {x: x**2 for x in range(10) if x % 2 == 0}
```

## Функции
- `def func(a, b=10, *args, **kwargs): ...`
- Лямбды: `lambda x: x*2`
- Декораторы: функция, оборачивающая другую функцию

## Классы
```python
class Dog:
    def __init__(self, name):
        self.name = name
    def bark(self):
        return f"{self.name}: woof"
```

## Async/await
```python
import asyncio

async def main():
    await asyncio.sleep(1)
    print("done")

asyncio.run(main())
```

## pip
- `pip install package`
- `pip install -r requirements.txt`
- `pip freeze > requirements.txt`

## Полезные модули stdlib
- `os`, `sys`, `pathlib`, `shutil`
- `json`, `csv`, `re`
- `collections`, `itertools`, `functools`
- `dataclasses`, `typing`, `enum`

## Тестирование
- `pytest` — популярный фреймворк
- Файлы `test_*.py`, функции `def test_*():`
