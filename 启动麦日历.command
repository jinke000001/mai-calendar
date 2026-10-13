#!/bin/zsh
cd -- "${0:A:h}" || exit 1
task_node=$(command -v node)
if [[ -z "$task_node" && -x /usr/local/bin/node ]]; then task_node=/usr/local/bin/node; fi
if [[ -z "$task_node" && -x /opt/homebrew/bin/node ]]; then task_node=/opt/homebrew/bin/node; fi
if [[ -z "$task_node" ]]; then
  print '未找到 Node.js，请在 Codex 中说明这个提示。'
  read -k 1
  exit 1
fi
"$task_node" server.cjs
read -k 1
