#!/usr/bin/env python3
"""run_wrapper.py — Sandboxed execution wrapper for user-generated Python code.

Reads JSON from stdin with keys:
  - code: Python code string (pre-validated by validate_code.py)
  - rows: SQL query results (list of dicts)
  - plan: PythonOutputPlan metadata
  - output_dir: temp directory for output files

Executes the code in a restricted namespace with pre-imported libraries.
Outputs JSON on stdout with:
  - success: bool
  - output_files: list of file paths
  - output_data: optional data
  - error: optional error message
"""

import sys
import json
import os
import traceback

# Pre-import allowed libraries
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import openpyxl
import reportlab
import csv
import io
import base64
import re
import math
import statistics
from datetime import datetime, date, timedelta


def main():
    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': f'Failed to parse input: {e}'
        }, ensure_ascii=False))
        sys.exit(1)

    code = input_data.get('code', '')
    rows = input_data.get('rows', [])
    plan = input_data.get('plan', {})
    output_dir = input_data.get('output_dir', os.getcwd())

    # Build restricted namespace
    namespace = {
        '__name__': '__sandbox__',
        'rows': rows,
        'plan': plan,
        'output_dir': output_dir,
        'pd': pd,
        'plt': plt,
        'np': np,
        'openpyxl': openpyxl,
        'reportlab': reportlab,
        'csv': csv,
        'io': io,
        'base64': base64,
        're': re,
        'math': math,
        'statistics': statistics,
        'datetime': datetime,
        'date': date,
        'timedelta': timedelta,
        '_output_files': [],
        '_output_data': None,
    }

    try:
        exec(code, namespace)
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({
            'success': False,
            'error': f'{type(e).__name__}: {e}',
            'traceback': tb
        }, ensure_ascii=False))
        sys.exit(0)  # Exit 0 so wrapper output is parsed

    output_files = namespace.get('_output_files', [])
    # Resolve relative paths to output_dir
    resolved_files = []
    for f in output_files:
        if os.path.isabs(f):
            resolved_files.append(f)
        else:
            resolved_files.append(os.path.join(output_dir, f))

    result = {
        'success': True,
        'output_files': resolved_files,
        'output_data': namespace.get('_output_data'),
    }
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
