const ADJECTIVES = [
  "quiet", "frosty", "sleepy", "brave", "gentle", "misty", "nimble", "shy", "sunny", "witty",
  "calm", "lucky", "polar", "chilly", "drifty", "fuzzy", "humble", "jolly", "lunar", "mellow",
  "nifty", "plucky", "rusty", "silky", "snowy", "spry", "steady", "tiny", "vivid", "wandering",
];

const ANIMALS = [
  "otter", "seal", "puffin", "walrus", "lynx", "hare", "owl", "fox", "moth", "heron",
  "narwhal", "badger", "wren", "marten", "beluga", "ibex", "krill", "lemming", "orca", "plover",
  "raven", "stoat", "tern", "vole", "yak", "pika", "newt", "gecko", "koala", "tapir",
];

function pick<T>(list: readonly T[]): T {
  const [r] = crypto.getRandomValues(new Uint32Array(1));
  return list[r! % list.length]!;
}

/** random per session, never stored */
export function randomNick(): string {
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;
}
