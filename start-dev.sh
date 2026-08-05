#!/bin/bash
# Detached dev server launcher — fully double-forks to escape process group.
cd /home/z/my-project
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "next-server" 2>/dev/null
sleep 1
rm -f dev.log

# Double-fork to fully detach
(
  (
    exec node_modules/.bin/next dev -p 3000 </dev/null >dev.log 2>&1
  ) &
  echo $! > /tmp/molcraft-dev.pid
) </dev/null >/dev/null 2>&1 &
disown

sleep 3
echo "Dev server PID: $(cat /tmp/molcraft-dev.pid 2>/dev/null || unknown)"
ps aux | grep -E "next" | grep -v grep | head -3
