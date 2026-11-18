import { useEffect, useState } from "react";
import WebApp from "./tg.js";
import { api, haptic } from "./api";
import { msg } from "./errors";
import { Card, Empty, Loading } from "./components";

export default function TasksPage({ refresh }) {
    const [items, setItems] = useState(null);
    const [busy, setBusy] = useState(null);
    const [note, setNote] = useState({ text: "", bad: false });

    const load = () =>
        api("/tasks")
            .then((d) => setItems(d.items))
            .catch(() => setItems([]));
    useEffect(() => {
        load();
    }, []);

    const openLink = (t) => {
        if (!t.url) return;
        try {
            if (/t\.me\//.test(t.url)) WebApp.openTelegramLink(t.url);
            else WebApp.openLink(t.url);
        } catch {
            window.open(t.url, "_blank");
        }
    };

    const call = async (t, action) => {
        setBusy(t.id);
        setNote({ text: "", bad: false });
        try {
            const r = await api(`/tasks/${t.id}/${action}`, { method: "POST" });
            if (action === "claim") {
                haptic("success");
                setNote({ text: `🎉 +${r.reward} পয়েন্ট পেয়েছেন!`, bad: false });
                refresh();
            }
            await load();
        } catch (e) {
            setNote({ text: msg(e), bad: true });
        }
        setBusy(null);
    };

    return (
        <>
            <h2>টাস্ক</h2>
            <p className="hint small">টাস্ক সম্পন্ন করে পয়েন্ট নিন। দৈনিক টাস্ক রাত ১২টায় রিসেট হয়।</p>
            {note.text && <p className={note.bad ? "err" : "ok"}>{note.text}</p>}

            {!items && <Loading />}
            {items && items.length === 0 && <Empty>এখন কোনো টাস্ক নেই।</Empty>}

            {items &&
                items.map((t) => (
                    <Card key={t.id}>
                        <div className="row between">
                            <b>{t.title}</b>
                            <span className="hint small">+{t.rewardPoints} পয়েন্ট</span>
                        </div>
                        {t.description && <p className="hint small">{t.description}</p>}

                        <div className="row gap">
                            {t.claimed ? (
                                <button className="btn" disabled>✓ সম্পন্ন</button>
                            ) : t.completed ? (
                                <button className="btn" disabled={busy === t.id} onClick={() => call(t, "claim")}>
                                    ক্লেইম করুন (+{t.rewardPoints})
                                </button>
                            ) : t.type === "WATCH_AD" ? (
                                <button className="btn" disabled>শীঘ্রই আসছে</button>
                            ) : (
                                <>
                                    <button className="btn secondary" onClick={() => openLink(t)}>
                                        {t.type === "JOIN_CHANNEL" ? "জয়েন করুন" : "শুরু করুন"}
                                    </button>
                                    <button className="btn" disabled={busy === t.id} onClick={() => call(t, "complete")}>
                                        {busy === t.id ? "..." : "যাচাই করুন"}
                                    </button>
                                </>
                            )}
                        </div>
                    </Card>
                ))}
        </>
    );
}