#!/bin/bash
# Dev server watchdog — restarts next dev if it dies.
cd /home/z/my-project
while true; do
  if ! pgrep -f "next-server" >/dev/null 2>&1; then
    echo "[$(date)] next-server down, restarting..." >> /home/z/my-project/watchdog.log
    pkill -9 -f "next dev" 2>/dev/null
    pkill -9 -f "next-server" 2>/dev/null
    sleep 1
    (
      (
        exec node_modules/.bin/next dev -p 3000 </dev/null >dev.log 2>&1
      ) &
      echo $! > /tmp/molcraft-dev.pid
    ) </dev/null >/dev/null 2>&1 &
    disown
    sleep 5
  fi
  sleep 10
done
