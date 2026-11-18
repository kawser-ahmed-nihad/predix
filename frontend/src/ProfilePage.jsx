import { useEffect, useState } from "react";
import WebApp from "./tg.js";
import { api, haptic } from "./api";
import { msg, LEVEL, PRED_STATUS, WD_STATUS } from "./Errors";
import { Bar, Card, Empty, Loading } from "./Components";

const HIST = [
    { id: "", label: "সব" },
    { id: "pending", label: "অপেক্ষমাণ" },
    { id: "won", label: "জেতা" },
    { id: "lost", label: "হারা" },
];

export default function ProfilePage({ user, refresh }) {
    const [stats, setStats] = useState(null);
    const [best, setBest] = useState(0);
    const [hist, setHist] = useState(null);
    const [histFilter, setHistFilter] = useState("");
    const [info, setInfo] = useState(null);
    const [wds, setWds] = useState([]);
    const [settings, setSettings] = useState(null);
    const [showRules, setShowRules] = useState(false);

    const loadMoney = () => {
        api("/withdrawals/info").then(setInfo).catch(() => { });
        api("/withdrawals").then((d) => setWds(d.items)).catch(() => { });
    };

    useEffect(() => {
        api("/checkin/status").then((c) => setBest(c.bestStreak)).catch(() => { });
        api("/settings").then(setSettings).catch(() => { });
        loadMoney();
    }, []);

    useEffect(() => {
        setHist(null);
        api(`/predictions/mine?status=${histFilter}`)
            .then((d) => {
                setHist(d.items);
                if (histFilter === "") setStats(d.stats);
            })
            .catch(() => setHist([]));
    }, [histFilter]);

    const toggleNotify = async () => {
        const next = !settings.notifications;
        setSettings({ ...settings, notifications: next });
        api("/settings", { method: "POST", body: JSON.stringify({ notifications: next }) }).catch(() =>
            setSettings({ ...settings, notifications: !next })
        );
    };

    return (
        <>
            {/* header */}
            <div className="row">
                {user.photoUrl ? (
                    <img className="logo" src={user.photoUrl} alt="" />
                ) : (
                    <div className="logo ph">{(user.firstName || "U")[0]}</div>
                )}
                <div>
                    <b>{user.firstName || user.username || "ইউজার"}</b>
                    <div className="hint small">{LEVEL[user.level] || user.level}</div>
                </div>
            </div>

            {/* stats */}
            {stats && (
                <div className="grid2 gap">
                    <Card>
                        <div className="hint small">মোট প্রেডিকশন</div>
                        <div className="big">{stats.total}</div>
                    </Card>
                    <Card>
                        <div className="hint small">সঠিকের হার</div>
                        <div className="big">{stats.accuracy}%</div>
                    </Card>
                    <Card>
                        <div className="hint small">টানা সঠিক</div>
                        <div className="big">{stats.winStreak}</div>
                    </Card>
                    <Card>
                        <div className="hint small">জেতা</div>
                        <div className="big">{stats.won}</div>
                    </Card>
                </div>
            )}

            {/* achievements (progress calculated from your stats) */}
            {stats && (
                <>
                    <h3>অ্যাচিভমেন্ট</h3>
                    <Badge icon="🎯" title="Prediction Pro" sub="৫০টি সঠিক প্রেডিকশন" value={stats.won} max={50} />
                    <Badge icon="🎮" title="Game Master" sub="১০০টি প্রেডিকশন করুন" value={stats.total} max={100} />
                    <Badge icon="🔥" title="Daily Streak" sub="টানা ৭ দিন চেক-ইন" value={best} max={7} />
                </>
            )}

            {/* withdraw */}
            <h3>উইথড্রয়াল</h3>
            <WithdrawBox info={info} onDone={() => { loadMoney(); refresh(); }} />

            {wds.length > 0 && (
                <>
                    <p className="hint small gap">উইথড্রয়াল ইতিহাস</p>
                    {wds.map((w) => (
                        <Card key={w.id}>
                            <div className="row between">
                                <b>৳{w.amountBdt}</b>
                                <span className={w.status === "REJECTED" ? "err" : w.status === "PAID" ? "ok" : "hint small"}>
                                    {WD_STATUS[w.status]}
                                </span>
                            </div>
                            <div className="hint small">
                                {w.tokens} টোকেন • {w.method} {w.account} •{" "}
                                {new Date(w.createdAt).toLocaleDateString("bn-BD")}
                            </div>
                            {w.adminNote && <div className="err">কারণ: {w.adminNote}</div>}
                        </Card>
                    ))}
                </>
            )}

            {/* prediction history */}
            <h3>আমার প্রেডিকশন</h3>
            <div className="chips">
                {HIST.map((f) => (
                    <button
                        key={f.id}
                        className={`chip ${histFilter === f.id ? "active" : ""}`}
                        onClick={() => setHistFilter(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
            {!hist && <Loading />}
            {hist && hist.length === 0 && <Empty>কিছু পাওয়া যায়নি।</Empty>}
            {hist &&
                hist.map((p) => (
                    <Card key={p.id}>
                        <div className="row between small hint">
                            <span>
                                {p.match.teamA} vs {p.match.teamB}
                            </span>
                            <span>{PRED_STATUS[p.status]}</span>
                        </div>
                        <div>{p.market.question}</div>
                        <div className="small">
                            আপনার উত্তর: <b>{p.choice}</b>
                            {p.status === "WON" && ` • +${p.reward} টোকেন (×${p.multiplier.toFixed(1)})`}
                            {p.status === "LOST" && p.market.result && ` • সঠিক: ${p.market.result}`}
                        </div>
                    </Card>
                ))}

            {/* settings */}
            <h3>সেটিংস</h3>
            {settings && (
                <Card>
                    <div className="row between">
                        <span>বট নোটিফিকেশন</span>
                        <button className="btn small" onClick={toggleNotify}>
                            {settings.notifications ? "চালু ✓" : "বন্ধ"}
                        </button>
                    </div>
                </Card>
            )}

            <Card onClick={() => setShowRules(!showRules)}>
                <div className="row between">
                    <b>নিয়মাবলি ও FAQ</b>
                    <span>{showRules ? "▲" : "▼"}</span>
                </div>
                {showRules && (
                    <div className="small">
                        <p>• এটি একটি বিনোদনমূলক অ্যাপ। কোনো টাকা জমা দিতে হয় না।</p>
                        <p>• প্রতিদিন ২টা প্রেডিকশন ফ্রি। এর বেশি করতে পয়েন্ট খরচ হয়।</p>
                        <p>• সঠিক প্রেডিকশনে টোকেন পাবেন। টানা সঠিক হলে বোনাস।</p>
                        <p>• টোকেনের টাকার মূল্য দৈনিক বিজ্ঞাপন আয়ের উপর নির্ভর করে এবং প্রতিদিন বদলাতে পারে।</p>
                        <p>• ম্যাচ বাতিল হলে খরচ করা পয়েন্ট ফেরত পাবেন।</p>
                        <p>• একজনের একটাই অ্যাকাউন্ট। একাধিক অ্যাকাউন্ট ধরা পড়লে পুরস্কার বন্ধ হতে পারে।</p>
                    </div>
                )}
            </Card>

            {import.meta.env.VITE_SUPPORT_URL && (
                <button
                    className="btn secondary"
                    onClick={() => WebApp.openTelegramLink(import.meta.env.VITE_SUPPORT_URL)}
                >
                    সাপোর্টে যোগাযোগ
                </button>
            )}
        </>
    );
}

function Badge({ icon, title, sub, value, max }) {
    const done = value >= max;
    return (
        <Card>
            <div className="row between">
                <b>
                    {icon} {title}
                </b>
                <span className="small">{done ? "অর্জিত ✓" : `${Math.min(value, max)}/${max}`}</span>
            </div>
            <p className="hint small">{sub}</p>
            <Bar value={value} max={max} />
        </Card>
    );
}

function WithdrawBox({ info, onDone }) {
    const [tokens, setTokens] = useState("");
    const [method, setMethod] = useState("bKash");
    const [account, setAccount] = useState("");
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState({ text: "", bad: false });

    if (!info) return <Loading />;

    const t = Number(tokens) || 0;
    const estimate = info.rate ? (t * Number(info.rate)).toFixed(2) : null;

    const submit = async () => {
        setBusy(true);
        setNote({ text: "", bad: false });
        try {
            const r = await api("/withdrawals", {
                method: "POST",
                body: JSON.stringify({ tokens: t, method, account }),
            });
            haptic("success");
            setNote({ text: `✅ অনুরোধ জমা হয়েছে (৳${r.amountBdt})। অপেক্ষমাণ আছে।`, bad: false });
            setTokens("");
            onDone();
        } catch (e) {
            setNote({ text: msg(e), bad: true });
        }
        setBusy(false);
    };

    return (
        <Card>
            <div className="row between">
                <span>আপনার টোকেন</span>
                <b>{info.tokens}</b>
            </div>
            <div className="row between small hint">
                <span>আজকের রেট</span>
                <span>{info.rate ? `১ টোকেন = ৳${Number(info.rate).toFixed(4)}` : "এখনো নির্ধারিত হয়নি"}</span>
            </div>
            <div className="row between small hint">
                <span>ন্যূনতম উইথড্রয়াল</span>
                <span>{info.minTokens} টোকেন</span>
            </div>
            <p className="hint small">{info.notice}</p>

            <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder="কত টোকেন তুলবেন"
                value={tokens}
                onChange={(e) => setTokens(e.target.value)}
            />
            {estimate && t > 0 && <p className="small">আনুমানিক: ৳{estimate}</p>}

            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {info.methods.map((m) => (
                    <option key={m} value={m}>
                        {m}
                    </option>
                ))}
            </select>
            <input
                className="input"
                inputMode="numeric"
                maxLength={11}
                placeholder="মোবাইল নম্বর (01XXXXXXXXX)"
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))}
            />

            {!info.accountAgeOk && (
                <p className="err">
                    নতুন অ্যাকাউন্ট থেকে {new Date(info.availableAt).toLocaleDateString("bn-BD")} এর পর উইথড্রয় করতে পারবেন।
                </p>
            )}
            {note.text && <p className={note.bad ? "err" : "ok"}>{note.text}</p>}

            <button
                className="btn"
                disabled={busy || t < info.minTokens || !/^01[3-9]\d{8}$/.test(account)}
                onClick={submit}
            >
                {busy ? "অপেক্ষা করুন..." : "উইথড্রয়াল অনুরোধ করুন"}
            </button>
        </Card>
    );
}