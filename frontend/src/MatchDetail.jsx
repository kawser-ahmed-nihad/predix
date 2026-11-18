import { useEffect, useState } from "react";
import WebApp from "./tg.js";
import { api, haptic } from "./api";
import { msg, DIFF, PRED_STATUS } from "./errors";
import { Card, Countdown, Loading, Sheet, TeamLogo } from "./components";
import { useCountdown } from "./Hooks/Hooks";

export default function MatchDetail({ id, onBack, refresh }) {
    const [d, setD] = useState(null);
    const [pick, setPick] = useState(null); // { mk, choice }

    const load = () =>
        api(`/matches/${id}`)
            .then(setD)
            .catch(() => setD({ error: true }));

    useEffect(() => {
        load();
    }, [id]);

    // Telegram's own back button
    useEffect(() => {
        try {
            WebApp.BackButton.show();
            WebApp.BackButton.onClick(onBack);
        } catch {
            /* not in Telegram */
        }
        return () => {
            try {
                WebApp.BackButton.offClick(onBack);
                WebApp.BackButton.hide();
            } catch {
                /* ignore */
            }
        };
    }, []);

    if (!d) return <Loading />;
    if (d.error) {
        return (
            <>
                <button className="btn secondary" onClick={onBack}>← ফিরে যান</button>
                <p className="err center pad">ম্যাচটি লোড করা যায়নি।</p>
            </>
        );
    }

    const m = d.match;
    const live = m.status === "LIVE";

    return (
        <>
            <button className="btn secondary small" onClick={onBack}>← ম্যাচ তালিকা</button>

            <Card className="gap">
                <div className="row between small hint">
                    <span>{m.tournament || "ক্রিকেট"}</span>
                    {live && <span className="badge live">● লাইভ</span>}
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
                {m.status === "FINISHED" && m.winner && <p className="center">🏆 বিজয়ী: {m.winner}</p>}
                {m.status === "CANCELLED" && <p className="hint center">ম্যাচ বাতিল হয়েছে</p>}
            </Card>

            {d.markets.length === 0 && <p className="hint center pad">এই ম্যাচে এখনো প্রশ্ন নেই।</p>}

            {d.markets.map((mk) => (
                <MarketCard
                    key={mk.id}
                    mk={mk}
                    now={d.now}
                    onPick={(choice) => setPick({ mk, choice })}
                />
            ))}

            {pick && (
                <ConfirmSheet
                    mk={pick.mk}
                    choice={pick.choice}
                    onClose={() => setPick(null)}
                    onDone={() => {
                        setPick(null);
                        load();
                        refresh();
                    }}
                />
            )}
        </>
    );
}

function MarketCard({ mk, now, onPick }) {
    const left = useCountdown(mk.locksAt, now);
    const open = mk.isOpen && left > 0;
    const mine = mk.myPrediction;

    return (
        <Card>
            <div className="row between">
                <b>{mk.question}</b>
                <span className={`tag ${mk.difficulty}`}>{DIFF[mk.difficulty]}</span>
            </div>
            <div className="row between small hint gap">
                <span>🏆 সঠিক হলে {mk.reward} টোকেন</span>
                <span>{open ? <>⏱ <Countdown target={mk.locksAt} serverNow={now} /></> : "বন্ধ"}</span>
            </div>

            <div className="opts">
                {mk.options.map((o) => (
                    <button
                        key={o}
                        className={`opt ${mine?.choice === o ? "picked" : ""} ${mk.result === o ? "correct" : ""}`}
                        disabled={!open || !!mine}
                        onClick={() => onPick(o)}
                    >
                        {o}
                        {mine?.choice === o && " ✓"}
                        {mk.result === o && " 🏆"}
                    </button>
                ))}
            </div>

            {mine && (
                <p className="small gap">
                    আপনার প্রেডিকশন: <b>{mine.choice}</b> — {PRED_STATUS[mine.status]}
                    {mine.status === "WON" && ` (+${mine.reward} টোকেন)`}
                </p>
            )}
        </Card>
    );
}

function ConfirmSheet({ mk, choice, onClose, onDone }) {
    const [q, setQ] = useState(null);
    const [state, setState] = useState("idle"); // idle | busy | done
    const [err, setErr] = useState("");

    useEffect(() => {
        api("/predictions/quota").then(setQ).catch(() => { });
    }, []);

    const free = !q || q.freeLeft > 0;
    const cost = free ? 0 : q.extraCost;
    const noLimitLeft = q && !free && q.extraLeft <= 0;
    const noPoints = q && !free && q.points < cost;

    const submit = async () => {
        setState("busy");
        setErr("");
        try {
            await api("/predictions", {
                method: "POST",
                body: JSON.stringify({ marketId: mk.id, choice }),
            });
            haptic("success");
            setState("done");
            setTimeout(onDone, 1000);
        } catch (e) {
            haptic("error");
            setErr(msg(e));
            setState("idle");
        }
    };

    if (state === "done") {
        return (
            <Sheet onClose={() => { }}>
                <div className="lockdone">🔒 প্রেডিকশন লক হয়েছে!</div>
            </Sheet>
        );
    }

    return (
        <Sheet onClose={state === "busy" ? () => { } : onClose}>
            <h3 style={{ marginTop: 0 }}>প্রেডিকশন নিশ্চিত করুন</h3>
            <p className="hint small">{mk.question}</p>
            <p>
                আপনার পছন্দ: <b>{choice}</b>
            </p>

            <div className="card">
                <div className="row between">
                    <span>খরচ</span>
                    <b>{free ? "ফ্রি" : `${cost} পয়েন্ট`}</b>
                </div>
                <div className="row between">
                    <span>সঠিক হলে</span>
                    <b>{mk.reward} টোকেন</b>
                </div>
                {q && q.winStreak > 0 && (
                    <div className="row between small hint">
                        <span>টানা সঠিক: {q.winStreak}</span>
                        <span>×{(1 + Math.min(q.winStreak, 5) * 0.1).toFixed(1)} বোনাস</span>
                    </div>
                )}
            </div>

            {q && (
                <p className="hint small">
                    আজকের ফ্রি: {q.freeLeft}/{q.freePerDay} • আপনার পয়েন্ট: {q.points}
                </p>
            )}
            {noLimitLeft && <p className="err">আজকের প্রেডিকশনের সীমা শেষ।</p>}
            {noPoints && <p className="err">যথেষ্ট পয়েন্ট নেই। চেক-ইন ও টাস্ক করে পয়েন্ট জমান।</p>}
            {err && <p className="err">{err}</p>}

            <button
                className="btn"
                disabled={state === "busy" || !q || noLimitLeft || noPoints}
                onClick={submit}
            >
                {state === "busy" ? "অপেক্ষা করুন..." : "নিশ্চিত করুন"}
            </button>
            <button className="btn secondary gap" onClick={onClose} disabled={state === "busy"}>
                বাতিল
            </button>
        </Sheet>
    );
}