/**
 * A string read from the database as a member of a contracts enum. Prisma and
 * contracts spell the same values, but a migration can leave one behind the
 * other: the check runs here, once, instead of a cast at every read.
 */
export function enumValue<E extends Record<string, string>>(
  enumObject: E,
  value: string,
): E[keyof E] {
  const members: readonly string[] = Object.values(enumObject);
  if (!members.includes(value)) {
    throw new Error(`"${value}" is not a value of the expected enum`);
  }
  return value as E[keyof E];
}
