import { useCountdown, fmt } from "./Hooks/Hooks";

export function Loading() {
    return <p className="hint center pad">লোড হচ্ছে...</p>;
}

export function Empty({ children }) {
    return <p className="hint center pad">{children}</p>;
}

export function Card({ children, onClick, className = "" }) {
    return (
        <div className={`card ${onClick ? "tap" : ""} ${className}`} onClick={onClick}>
            {children}
        </div>
    );
}

export function Countdown({ target, serverNow }) {
    const ms = useCountdown(target, serverNow);
    return <span>{ms <= 0 ? "বন্ধ" : fmt(ms)}</span>;
}

export function TeamLogo({ src, name }) {
    return src ? (
        <img className="logo" src={src} alt="" />
    ) : (
        <div className="logo ph">{(name || "?")[0]}</div>
    );
}

export function Bar({ value, max }) {
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return (
        <div className="bar">
            <div style={{ width: `${pct}%` }} />
        </div>
    );
}

export function Sheet({ onClose, children }) {
    return (
        <div className="overlay" onClick={onClose}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <div className="grab" />
                {children}
            </div>
        </div>
    );
}

export function MatchCard({ m, now, onClick }) {
    const live = m.status === "LIVE";
    const when = new Date(m.startTime).toLocaleString("bn-BD", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });

    return (
        <Card onClick={onClick}>
            <div className="row between small hint">
                <span>{m.tournament || "ক্রিকেট"}</span>
                {live ? <span className="badge live">● লাইভ</span> : <span>{when}</span>}
            </div>

            <div className="teams">
                <div className="team">
                    <TeamLogo src={m.teamALogo} name={m.teamA} />
                    <span>{m.teamA}</span>
                </div>
                <span className="vs">vs</span>
                <div className="team">
                    <TeamLogo src={m.teamBLogo} name={m.teamB} />
                    <span>{m.teamB}</span>
                </div>
            </div>

            {m.openMarkets > 0 && m.nextLockAt && (
                <div className="small hint center">
                    ⏱ প্রেডিকশন বন্ধ হতে: <Countdown target={m.nextLockAt} serverNow={now} />
                </div>
            )}
            {m.status === "FINISHED" && m.winner && (
                <div className="small center">🏆 বিজয়ী: {m.winner}</div>
            )}
            {m.status === "CANCELLED" && <div className="small hint center">ম্যাচ বাতিল</div>}
        </Card>
    );
}