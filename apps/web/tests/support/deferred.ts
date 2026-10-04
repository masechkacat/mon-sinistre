/**
 * A promise a route mock can await and the test releases by hand: the window
 * between the request and its answer — where the pending label lives, and
 * where a stale list is still on screen — is then a step of the test instead
 * of a race against the network.
 */
export function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}
