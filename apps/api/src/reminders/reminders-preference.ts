/** No `User.remindersDisabledAt` means the reminders are on. */
export const remindersEnabled = (remindersDisabledAt: Date | null): boolean =>
  remindersDisabledAt === null;
