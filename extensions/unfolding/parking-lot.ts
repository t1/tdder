export class ParkingLot {
  private pending = new Map<string, (outcome: "accepted" | "in_progress") => void>();

  park(slug: string): Promise<"accepted" | "in_progress"> {
    if (this.pending.has(slug)) {
      throw new Error(`Task "${slug}" is already parked`);
    }
    return new Promise(resolve => {
      this.pending.set(slug, resolve);
    });
  }

  release(slug: string, outcome: "accepted" | "in_progress"): void {
    const resolve = this.pending.get(slug);
    if (resolve) {
      this.pending.delete(slug);
      resolve(outcome);
    }
  }
}
