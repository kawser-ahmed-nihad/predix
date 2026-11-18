import { useState } from "react";

const STEPS = [
    {
        emoji: "🏏",
        title: "পূর্বাভাস দিন",
        text: "ক্রিকেট ম্যাচের টস, বিজয়ী ও আরও অনেক কিছুর পূর্বাভাস দিন। প্রতিদিন ২টা প্রেডিকশন ফ্রি।",
    },
    {
        emoji: "🏆",
        title: "টোকেন জিতুন",
        text: "সঠিক হলে টোকেন পাবেন। টানা সঠিক হলে বোনাস মাল্টিপ্লায়ার। চেক-ইন ও টাস্ক করে পয়েন্ট নিন।",
    },
    {
        emoji: "👥",
        title: "বন্ধুদের নিয়ে খেলুন",
        text: "বন্ধুদের আমন্ত্রণ জানান ও পুরস্কার পান। কোনো টাকা জমা দিতে হয় না। টোকেনের মূল্য দৈনিক বিজ্ঞাপন আয়ের উপর নির্ভর করে।",
    },
];

export default function Onboarding({ onDone }) {
    const [i, setI] = useState(0);
    const s = STEPS[i];
    const last = i === STEPS.length - 1;

    return (
        <div className="onboard">
            <div className="emoji">{s.emoji}</div>
            <h2>{s.title}</h2>
            <p className="hint">{s.text}</p>

            <div className="dots">
                {STEPS.map((_, k) => (
                    <i key={k} className={k === i ? "on" : ""} />
                ))}
            </div>

            <button className="btn" onClick={() => (last ? onDone() : setI(i + 1))}>
                {last ? "শুরু করুন" : "পরের ধাপ"}
            </button>
            {!last && (
                <button className="btn secondary" onClick={onDone}>
                    এড়িয়ে যান
                </button>
            )}
        </div>
    );
}