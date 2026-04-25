# Coding Input Parsing README

This document explains how coding input is handled in the LMS coding runner, from testcase creation to result evaluation.

## Purpose

The system supports practical input handling for coding questions so students can write normal code style in Python, Java, C, and C++ without constantly rewriting parsing logic for simple tokenized inputs.

## 1. Where Testcase Input Comes From

Testcases are created in the Challenge Builder UI:

- Each testcase has:
  - `label`
  - `input`
  - `output`
- They are stored under:
  - `problem.properties.options.code.validations[]`

In UI terms, this is the Test Cases section with Input and Expected Output fields.

## 2. Runtime Flow (Compile and Submit)

For Compile and Test and Submit Code:

1. Frontend builds a run payload with:
   - `language`
   - `fileName`
   - `code`
   - `stdin`
2. For testcase execution, `stdin` is sent as an array, one entry per testcase input.
3. Backend `/compiler/run` normalizes files and forwards payload to OneCompiler `/v1/run`.
4. Frontend maps each execution result back to its testcase.

## 3. Output Comparison Rules

Each testcase result is evaluated as:

- Read `stdout` and `stderr`
- Normalize actual and expected output:
  - Convert CRLF to LF
  - Trim surrounding whitespace
  - Apply lowercase if `ignoreCase` is enabled
- Pass condition:
  - No `stderr`
  - Normalized actual output equals normalized expected output

## 4. Input Retry Fallback for Tokenized Single-Line Input

To improve usability, the runner includes a fallback retry for these languages:

- Python
- Java
- C
- C++

### When fallback retry runs

Fallback is attempted only if all of these are true:

1. Initial testcase run failed
2. Testcase input is single-line and space-separated (example: `3 4`)
3. Input is not already multiline
4. Language is one of the 4 listed above

### What fallback does

- Converts tokenized single-line input to newline form
  - Example: `3 4` becomes:
    - `3`
    - `4`
- Reruns only the failed eligible testcases (not all cases)
- If retry succeeds without runtime error, retry result replaces initial failed result

This allows students to write code like:

Python:

```python
a = int(input())
b = int(input())
print(a + b)
```

and still pass testcase input written as `3 4`.

## 5. Custom Input Run Behavior

For Custom Input mode (manual run):

- Input is sent exactly as typed by the user
- No tokenized fallback retry is applied

So custom input remains fully literal and controlled by the student.

## 6. Java File/Class Handling

To avoid Java class loading issues:

- Frontend sends `Main.java` for Java runs
- Backend also normalizes `main.java` to `Main.java`

This prevents errors such as:

- `Could not find or load main class main`

## 7. Works for Linked List, Tree, and Graph Questions

Yes, input handling supports these question types as long as input is text-serialized through stdin.

Important note:

- The platform does not auto-build data structures
- Student code must still parse input and construct linked lists, trees, and graphs as required by problem statement

## 8. Recommended Authoring Guidelines

For reliable judging:

1. Define clear input format in the question statement
2. Keep testcase input consistent with that format
3. Prefer deterministic outputs (avoid ambiguous formatting)
4. Use `ignoreCase` only when case-insensitive output is intended
5. Include edge cases:
   - Empty/small inputs
   - Negative values
   - Large values
   - Disconnected graph cases, skewed trees, etc.

## 9. Quick Examples

### Simple sum

- Input: `3 4`
- Output: `7`
- Works with both token-based and line-based read styles due to fallback.

### Graph input

- Input:
  - `5 4`
  - `1 2`
  - `2 3`
  - `3 4`
  - `4 5`
- Student should parse `n`, `m`, then `m` edges and build adjacency list.

### Tree input

- Input:
  - `7`
  - `1 2`
  - `1 3`
  - `2 4`
  - `2 5`
  - `3 6`
  - `3 7`
- Student should parse edges and build tree representation.

## 10. Current Scope Summary

The fallback currently applies to testcase execution paths:

- Compile and Test
- Submit Code

It does not apply to:

- Custom Input literal runs

---

If needed later, this can be extended to support configurable fallback modes per challenge or per language profile.
