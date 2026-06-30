#!/usr/bin/env python3
"""validate_code.py — AST validator for sandboxed Python code.

Reads code from stdin, outputs 'OK' or 'REJECTED: <reason>' on stdout.
Checks:
1. Only whitelisted imports are allowed
2. Blocked builtins (__import__, eval, exec, compile, open, globals, locals) are forbidden
3. No attribute access to __builtins__, __globals__, __locals__
"""

import ast
import sys

ALLOWED_IMPORTS = {
    'pandas', 'matplotlib', 'matplotlib.pyplot', 'matplotlib.pylab',
    'numpy', 'openpyxl', 'reportlab',
    'json', 'datetime', 'math', 'io', 'csv', 'base64', 're',
    'statistics', 'decimal', 'collections', 'itertools', 'functools',
    'string', 'textwrap', 'unicodedata',
}

BLOCKED_BUILTINS = {
    '__import__', 'eval', 'exec', 'compile', 'open', 'globals', 'locals',
}

BLOCKED_ATTRS = {
    '__builtins__', '__globals__', '__locals__', '__code__',
    '__func__', '__self__', '__class__', '__subclasses__',
}


def validate(code: str) -> str | None:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f'REJECTED: Syntax error: {e}'

    for node in ast.walk(tree):
        # Check imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    return f'REJECTED: Import "{alias.name}" is not in whitelist'
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ''
            for alias in node.names:
                full = f'{module}.{alias.name}' if module else alias.name
                if full not in ALLOWED_IMPORTS and module not in ALLOWED_IMPORTS:
                    return f'REJECTED: Import "{full}" is not in whitelist'

        # Check Call nodes for blocked builtins
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in BLOCKED_BUILTINS:
                    return f'REJECTED: Call to blocked builtin "{node.func.id}"'

        # Check Attribute access for blocked attrs
        elif isinstance(node, ast.Attribute):
            if node.attr in BLOCKED_ATTRS:
                return f'REJECTED: Access to blocked attribute "{node.attr}"'

        # Check Name nodes for blocked builtins used as values
        elif isinstance(node, ast.Name):
            if node.id in BLOCKED_BUILTINS:
                return f'REJECTED: Use of blocked builtin "{node.id}"'

    return None


def main():
    code = sys.stdin.read()
    result = validate(code)
    if result is None:
        print('OK')
    else:
        print(result)
        sys.exit(1)


if __name__ == '__main__':
    main()
