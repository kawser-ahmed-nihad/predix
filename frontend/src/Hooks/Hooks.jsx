import { useEffect, useState } from "react";

// Milliseconds left until `target`, counted on the SERVER's clock.
// `serverNow` is the time the server sent with the data, so a wrong clock on
// the phone does not change the countdown.
export function useCountdown(target, serverNow) {
    const offset = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;
    const calc = () => Math.max(0, new Date(target).getTime() - (Date.now() + offset));
    const [ms, setMs] = useState(calc);

    useEffect(() => {
        setMs(calc());
        const t = setInterval(() => setMs(calc()), 1000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target, serverNow]);

    return ms;
}

export function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}দিন ${h}ঘ`;
    if (h > 0) return `${h}ঘ ${m}মি`;
    return `${m}:${String(sec).padStart(2, "0")}`;
}