import { useEffect, useState } from "react";
import WebApp from "./tg.js";
import { api } from "./api";

export default function ReferPage() {
    const [summary, setSummary] = useState(null);
    const [history, setHistory] = useState([]);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        Promise.all([api("/referral/summary"), api("/referral/history")])
            .then(([s, h]) => {
                setSummary(s);
                setHistory(h.items);
            })
            .catch(() => setError(true));
    }, []);

    if (error) return <p>লোড করা যায়নি, আবার চেষ্টা করুন।</p>;
    if (!summary) return <p>লোড হচ্ছে...</p>;

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(summary.link);
        } catch {
            // fallback for webviews that block the clipboard API
            const t = document.createElement("textarea");
            t.value = summary.link;
            document.body.appendChild(t);
            t.select();
            document.execCommand("copy");
            t.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const share = () => WebApp.openTelegramLink(summary.shareUrl);

    return (
        <div style={{ padding: 16 }}>
            <h2>বন্ধুদের আমন্ত্রণ করুন</h2>
            <p>
                বন্ধু জয়েন করে কমপক্ষে {summary.rules.minPredictions}টি প্রেডিকশন করলে
                আপনি পাবেন {summary.rules.rewardPoints} পয়েন্ট।
            </p>

            <div style={{ wordBreak: "break-all", padding: 12, borderRadius: 8, background: "#00000010" }}>
                {summary.link}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={copyLink} style={{ flex: 1, padding: 12 }}>
                    {copied ? "কপি হয়েছে ✓" : "লিংক কপি"}
                </button>
                <button onClick={share} style={{ flex: 1, padding: 12 }}>
                    টেলিগ্রামে শেয়ার
                </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, textAlign: "center" }}>
                <Stat label="মোট আমন্ত্রিত" value={summary.totalInvited} />
                <Stat label="সফল" value={summary.successful} />
                <Stat label="রেফারেল পয়েন্ট" value={summary.pointsEarned} />
            </div>

            <h3 style={{ marginTop: 24 }}>রেফারেল হিস্ট্রি</h3>
            {history.length === 0 && <p>এখনো কেউ জয়েন করেনি।</p>}
            {history.map((r) => (
                <div
                    key={r.id}
                    style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}
                >
                    <span>{r.name}</span>
                    <span>
                        {r.status === "SUCCESSFUL" ? `+${r.rewardPoints} পয়েন্ট ✓` : "অপেক্ষমাণ"}
                    </span>
                </div>
            ))}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div style={{ flex: 1, padding: 8, borderRadius: 8, background: "#00000010" }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 12 }}>{label}</div>
        </div>
    );
}