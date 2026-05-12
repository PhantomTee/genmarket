export function normalizePythonSource(source: string): string {
  return source
    .replace(/ /g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\t/g, "    ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}
