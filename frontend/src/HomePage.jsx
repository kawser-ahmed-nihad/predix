import { useEffect, useState } from "react";
import { api, haptic } from "./api";
import { msg, LEVEL } from "./errors";
import { Card, Empty, Loading, MatchCard } from "./components";

export default function HomePage({ user, refresh, go }) {
    const [quota, setQuota] = useState(null);
    const [ci, setCi] = useState(null);
    const [matches, setMatches] = useState(null);
    const [note, setNote] = useState({ text: "", bad: false });
    const [busy, setBusy] = useState(false);

    const load = () => {
        api("/predictions/quota").then(setQuota).catch(() => { });
        api("/checkin/status").then(setCi).catch(() => { });
        Promise.all([api("/matches?status=live"), api("/matches?status=upcoming")])
            .then(([l, u]) => setMatches({ now: u.now, items: [...l.items, ...u.items].slice(0, 3) }))
            .catch(() => setMatches({ now: null, items: [] }));
    };
    useEffect(() => {
        load();
    }, []);

    const doCheckin = async () => {
        setBusy(true);
        try {
            const r = await api("/checkin", { method: "POST" });
            haptic("success");
            setNote({ text: `🎉 +${r.reward} পয়েন্ট! স্ট্রিক: ${r.streak} দিন`, bad: false });
            load();
            refresh();
        } catch (e) {
            setNote({ text: msg(e), bad: true });
        }
        setBusy(false);
    };

    const filled = ci && ci.streak > 0 ? ((ci.streak - 1) % 7) + 1 : 0;

    return (
        <>
            <h2>হ্যালো, {user.firstName || "বন্ধু"} 👋</h2>
            <p className="hint small">{LEVEL[user.level] || user.level}</p>

            <div className="grid2">
                <Card>
                    <div className="hint small">টোকেন</div>
                    <div className="big">🏆 {user.tokens}</div>
                </Card>
                <Card>
                    <div className="hint small">পয়েন্ট</div>
                    <div className="big">⭐ {user.points}</div>
                </Card>
            </div>

            <Card>
                <div className="row between">
                    <b>আজকের ফ্রি প্রেডিকশন</b>
                    <b>{quota ? `${quota.freeLeft}/${quota.freePerDay}` : "–"}</b>
                </div>
                {quota && quota.freeLeft === 0 && (
                    <p className="hint small">
                        ফ্রি শেষ। এক্সট্রা প্রেডিকশনে {quota.extraCost} পয়েন্ট লাগবে (আজ আর {quota.extraLeft}টা)।
                    </p>
                )}
                <button className="btn gap" onClick={() => go("predict")}>
                    প্রেডিকশন করুন
                </button>
            </Card>

            <Card>
                <div className="row between">
                    <b>ডেইলি চেক-ইন</b>
                    <span className="hint small">স্ট্রিক: {ci ? ci.streak : 0} দিন 🔥</span>
                </div>
                {ci && (
                    <div className="days">
                        {ci.rewards.map((r, i) => (
                            <div key={i} className={`day ${i < filled ? "done" : ""}`}>
                                {r}
                            </div>
                        ))}
                    </div>
                )}
                <button className="btn" disabled={busy || !ci || ci.checkedInToday} onClick={doCheckin}>
                    {ci?.checkedInToday ? "আজ চেক-ইন হয়েছে ✓" : `চেক-ইন করুন (+${ci?.nextReward ?? ""})`}
                </button>
                {note.text && <p className={note.bad ? "err" : "ok"}>{note.text}</p>}
            </Card>

            <h3>লাইভ ও আসন্ন ম্যাচ</h3>
            {!matches && <Loading />}
            {matches && matches.items.length === 0 && <Empty>এখন কোনো ম্যাচ নেই।</Empty>}
            {matches &&
                matches.items.map((m) => (
                    <MatchCard key={m.id} m={m} now={matches.now} onClick={() => go("predict", m.id)} />
                ))}
        </>
    );
}