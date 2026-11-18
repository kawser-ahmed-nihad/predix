import { useEffect, useState } from "react";
import { api } from "./api";
import { Empty, Loading, MatchCard } from "./components";
import MatchDetail from "./MatchDetail";

const FILTERS = [
    { id: "live", label: "লাইভ" },
    { id: "upcoming", label: "আসন্ন" },
    { id: "finished", label: "শেষ হয়েছে" },
];

export default function PredictPage({ initialMatchId, refresh }) {
    const [filter, setFilter] = useState("upcoming");
    const [data, setData] = useState(null);
    const [selected, setSelected] = useState(initialMatchId);
    const [quota, setQuota] = useState(null);

    useEffect(() => {
        if (selected) return;
        setData(null);
        api(`/matches?status=${filter}`)
            .then(setData)
            .catch(() => setData({ now: null, items: [] }));
    }, [filter, selected]);

    useEffect(() => {
        api("/predictions/quota").then(setQuota).catch(() => { });
    }, [selected]);

    if (selected) {
        return <MatchDetail id={selected} onBack={() => setSelected(null)} refresh={refresh} />;
    }

    return (
        <>
            <h2>প্রেডিকশন</h2>

            {quota && (
                <div className="card row between">
                    <span>আজকের ফ্রি প্রেডিকশন</span>
                    <b>
                        {quota.freeLeft}/{quota.freePerDay} বাকি
                    </b>
                </div>
            )}

            <div className="chips">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        className={`chip ${filter === f.id ? "active" : ""}`}
                        onClick={() => setFilter(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {!data && <Loading />}
            {data && data.items.length === 0 && (
                <Empty>
                    {filter === "live" ? "এখন কোনো লাইভ ম্যাচ নেই।" : "কোনো ম্যাচ পাওয়া যায়নি।"}
                </Empty>
            )}
            {data &&
                data.items.map((m) => (
                    <MatchCard key={m.id} m={m} now={data.now} onClick={() => setSelected(m.id)} />
                ))}
        </>
    );
}