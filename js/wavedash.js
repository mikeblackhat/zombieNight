export const Wavedash = window.Wavedash ?? null;

export const WV_LEADERBOARD = "high-scores";
let wvLeaderboardId = null;

// Submit the run's score (total kills) on death. Defensive: any SDK/network
// failure is logged but never interrupts the game.
export async function wvSubmitScore(score) {
    if (!Wavedash) { console.warn("[wavedash] no SDK — score not submitted"); return; }
    try {
        if (wvLeaderboardId == null) {
            const lb = await Wavedash.getOrCreateLeaderboard(
                WV_LEADERBOARD,
                Wavedash.LeaderboardSortOrder.DESC,
                Wavedash.LeaderboardDisplayType.NUMERIC,
            );
            if (!lb?.success) {
                console.warn("[wavedash] could not get/create leaderboard:", lb?.message);
                return;
            }
            wvLeaderboardId = lb.data.id;
        }
        const res = await Wavedash.uploadLeaderboardScore(wvLeaderboardId, score, true); // keepBest
        if (!res?.success) {
            console.warn("[wavedash] score upload rejected:", res?.message);
        }
    } catch (e) {
        console.warn("[wavedash] score upload threw", e);
    }
}

// Achievements & stats
const wvUnlocked = new Set();
export function wvUnlock(id) {
    if (!Wavedash || wvUnlocked.has(id)) return;
    wvUnlocked.add(id);
    try {
        Wavedash.setAchievement(id, true); // storeNow → persist immediately
    } catch (e) {
        console.warn("[wavedash] achievement unlock failed", id, e);
    }
}

export const WV_STAT_KILLS = "KILLS_TOTAL";
export function wvAddKill() {
    if (!Wavedash) return;
    try {
        Wavedash.setStat(WV_STAT_KILLS, (Wavedash.getStat(WV_STAT_KILLS) || 0) + 1, true);
    } catch (e) {
        console.warn("[wavedash] kill stat failed", e);
    }
}

