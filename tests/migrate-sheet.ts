// one-shot: open the store, force migrations, exit
await import("../src/core/store.ts");
console.log("store opened, migrations applied");
