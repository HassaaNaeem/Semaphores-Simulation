"""
semaphores.py
=============
Reference implementation of Binary and Counting semaphores for the
"Semaphore Visualizer" project.

Two things live here:

1. REAL, runnable semaphores backed by threading primitives
   (CountingSemaphore / BinarySemaphore) plus a tiny worker demo.

2. A DETERMINISTIC trace generator (`trace`) that reproduces the exact
   step-by-step schedule shown in the front-end visualizer, so the
   terminal output and the animation line up one-to-one.

Run:
    python semaphores.py                 # deterministic trace (default)
    python semaphores.py --real          # real multithreaded demo
    python semaphores.py --type binary --procs 4
    python semaphores.py --type counting --res 3 --procs 5
"""

from __future__ import annotations
import argparse
import threading
import time
import random
from dataclasses import dataclass, field


# ==========================================================================
# 1. REAL SEMAPHORES (thread-backed, correct synchronization)
# ==========================================================================

class CountingSemaphore:
    """Classic counting semaphore.

    `value` may go negative; when it does, |value| equals the number of
    processes currently blocked in the queue.
    """

    def __init__(self, n: int):
        self.value = n
        self._cond = threading.Condition()

    def wait(self, name: str = ""):          # P / acquire / down
        with self._cond:
            self.value -= 1
            if self.value < 0:
                # not enough resources -> block until signalled
                self._cond.wait()

    def signal(self, name: str = ""):        # V / release / up
        with self._cond:
            self.value += 1
            if self.value <= 0:
                # someone was waiting -> wake exactly one
                self._cond.notify()


class BinarySemaphore:
    """Binary semaphore (mutex). value is constrained to {0, 1}."""

    def __init__(self):
        self.value = 1
        self._cond = threading.Condition()

    def wait(self, name: str = ""):
        with self._cond:
            while self.value == 0:
                self._cond.wait()
            self.value = 0

    def signal(self, name: str = ""):
        with self._cond:
            self.value = 1
            self._cond.notify()


def real_demo(sem_type: str, n: int, procs: int):
    """Spin up real threads contending for the semaphore."""
    sem = BinarySemaphore() if sem_type == "binary" else CountingSemaphore(n)
    cap = 1 if sem_type == "binary" else n
    in_cs = []
    lock = threading.Lock()

    def worker(p: int):
        time.sleep(random.uniform(0, 0.3))
        print(f"  P{p}: calling wait()")
        sem.wait(f"P{p}")
        with lock:
            in_cs.append(p)
            assert len(in_cs) <= cap, "INVARIANT BROKEN: too many in critical section!"
            print(f"  P{p}: >>> ENTER critical section   (inside now: {sorted(in_cs)})")
        time.sleep(random.uniform(0.2, 0.6))     # pretend to use the resource
        with lock:
            in_cs.remove(p)
            print(f"  P{p}: <<< LEAVE critical section   (inside now: {sorted(in_cs)})")
        sem.signal(f"P{p}")

    print(f"\n[real demo] {sem_type} semaphore, capacity={cap}, processes={procs}\n")
    threads = [threading.Thread(target=worker, args=(p,)) for p in range(1, procs + 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print("\n[real demo] all processes complete. final value =", sem.value)


# ==========================================================================
# 2. DETERMINISTIC TRACE (mirrors the visualizer frame-for-frame)
# ==========================================================================

@dataclass
class TraceState:
    S: int
    cap: int
    cs: list = field(default_factory=list)       # in critical section
    blk: list = field(default_factory=list)       # blocked queue
    done: list = field(default_factory=list)

    def line(self) -> str:
        return (f"S={self.S:>3} | CS{self.cs or '[]'}"
                f" | blocked{self.blk or '[]'} | done{self.done or '[]'}")


def trace(sem_type: str, n: int, procs: int):
    """Reproduce the visualizer schedule: every process attempts wait() in
    id order, then in-CS processes signal() in FIFO order, waking blocked
    ones. Prints S and queue contents at every meaningful step.
    """
    is_bin = sem_type == "binary"
    cap = 1 if is_bin else n
    s = TraceState(S=1 if is_bin else n, cap=cap)

    def show(msg: str):
        print(f"  {s.line():<48}  {msg}")

    print(f"\n[trace] {sem_type} semaphore, capacity={cap}, processes={procs}")
    show("initial state")

    # ---- entry round ----
    for p in range(1, procs + 1):
        show(f"P{p} calls wait()")
        if not is_bin:
            s.S -= 1
            show(f"  value -= 1  ->  S = {s.S}")
            if s.S < 0:
                s.blk.append(p)
                show(f"  S < 0  ->  P{p} blocked")
            else:
                s.cs.append(p)
                show(f"  S >= 0  ->  P{p} ENTERS critical section")
        else:
            if s.S == 1:
                s.S = 0
                s.cs.append(p)
                show(f"  lock free  ->  S=0, P{p} ENTERS critical section")
            else:
                s.blk.append(p)
                show(f"  lock held  ->  P{p} blocked")

    # ---- exit round ----
    to_exit = list(s.cs)
    while to_exit:
        p = to_exit.pop(0)
        s.cs.remove(p)
        s.done.append(p)
        show(f"P{p} calls signal()")
        if not is_bin:
            s.S += 1
            show(f"  value += 1  ->  S = {s.S}")
            if s.S <= 0:
                w = s.blk.pop(0)
                s.cs.append(w)
                to_exit.append(w)
                show(f"  S <= 0  ->  wake P{w}, it ENTERS critical section")
        else:
            if s.blk:
                w = s.blk.pop(0)
                s.cs.append(w)
                to_exit.append(w)
                show(f"  queue not empty  ->  wake P{w} (lock handed over)")
            else:
                s.S = 1
                show(f"  queue empty  ->  S = 1 (lock released)")

    show("all processes complete")


# ==========================================================================
# CLI
# ==========================================================================

def main():
    ap = argparse.ArgumentParser(description="Binary / Counting semaphore demo")
    ap.add_argument("--type", choices=["binary", "counting"], default="counting")
    ap.add_argument("--res", type=int, default=3, help="resources / N (counting only)")
    ap.add_argument("--procs", type=int, default=5, help="number of processes")
    ap.add_argument("--real", action="store_true", help="run the real multithreaded demo")
    args = ap.parse_args()

    if args.real:
        real_demo(args.type, args.res, args.procs)
    else:
        trace(args.type, args.res, args.procs)


if __name__ == "__main__":
    main()