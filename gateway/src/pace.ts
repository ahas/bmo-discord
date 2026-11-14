// The provider's pace on an account: calls made one at a time, each started no sooner than the pace after the
// one before it ended (docs/discord.md, 「The owner's account」). A call that fails ends its turn all the same.

export class Pace {
  private tail: Promise<unknown> = Promise.resolve();
  private endedAt = Number.NEGATIVE_INFINITY;

  // Runs `work` in its turn, `gapMs` after the call before it ended.
  run<T>(gapMs: number, work: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(async () => {
      const wait = this.endedAt + gapMs - Date.now();

      if (wait > 0) {
        await Bun.sleep(wait);
      }

      try {
        return await work();
      } finally {
        this.endedAt = Date.now();
      }
    });

    this.tail = turn.catch(() => undefined);

    return turn;
  }
}
