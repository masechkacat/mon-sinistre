import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import { todayInParis } from 'src/common/time/today-in-paris';

/**
 * The first date every `IsNotFutureIsoDate` field refuses. `Europe/Paris` is
 * the timezone the validator compares against, and a UTC "tomorrow" is
 * already today in Paris between 22:00 and midnight UTC — a spec built on it
 * would see its request accepted for two hours a day.
 */
export const tomorrowInParis = () => resolveDeadline(todayInParis(), 1, 'DAYS');
