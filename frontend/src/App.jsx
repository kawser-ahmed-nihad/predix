import { useEffect, useState } from "react";
import { api, login } from "./api";
import { Loading } from "./components";
import HomePage from "./HomePage";
import PredictPage from "./PredictPage";
import TasksPage from "./TasksPage";
import ReferPage from "./ReferPage";
import ProfilePage from "./ProfilePage";
import Onboarding from "./Onboarding";

const TABS = [
  { id: "home", label: "হোম", icon: "🏠" },
  { id: "predict", label: "প্রেডিকশন", icon: "🎯" },
  { id: "tasks", label: "টাস্ক", icon: "✅" },
  { id: "refer", label: "রেফার", icon: "👥" },
  { id: "profile", label: "প্রোফাইল", icon: "👤" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [failed, setFailed] = useState(null);
  // const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("home");
  const [matchId, setMatchId] = useState(null);
  // open this match when going to "predict"

  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem("px_onboarded") === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    // login().then(setUser).catch(() => setFailed(true));
    login().then(setUser).catch((e) => setFailed(String(e?.message || e)));
  }, []);

  // reload balances after something changed them
  const refresh = () =>
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => { });

  // go("predict", 12) opens match 12
  const go = (t, id = null) => {
    setMatchId(id);
    setTab(t);
    window.scrollTo(0, 0);
  };

  if (failed) {
    return (
      <div className="page center">
        <h2>লোড করা যায়নি</h2>

        <p className="hint">অ্যাপটি টেলিগ্রামের ভেতর থেকে খুলুন, অথবা কিছুক্ষণ পরে আবার চেষ্টা করুন।</p>
        <p className="small">কারণ: {failed}</p>
      </div>
    );
  }
  if (!user) return <Loading />;

  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          try {
            localStorage.setItem("px_onboarded", "1");
          } catch {
            /* ignore */
          }
          setOnboarded(true);
        }}
      />
    );
  }

  return (
    <>
      <div className="page">
        {tab === "home" && <HomePage user={user} refresh={refresh} go={go} />}
        {tab === "predict" && (
          <PredictPage key={matchId ?? "list"} initialMatchId={matchId} refresh={refresh} />
        )}
        {tab === "tasks" && <TasksPage refresh={refresh} />}
        {tab === "refer" && <ReferPage />}
        {tab === "profile" && <ProfilePage user={user} refresh={refresh} />}
      </div>

      <div className="notice">বিনোদনমূলক • কোনো টাকা জমা লাগে না</div>

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => go(t.id)}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}