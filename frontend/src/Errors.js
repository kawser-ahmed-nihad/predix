// Turns an API error into a Bengali message for the user.

const TEXT = {
    market_closed: "এই প্রেডিকশনের সময় শেষ হয়ে গেছে",
    already_predicted: "এই প্রশ্নে আপনি আগেই প্রেডিকশন করেছেন",
    daily_limit_reached: "আজকের প্রেডিকশনের সীমা শেষ। কাল আবার চেষ্টা করুন",
    invalid_choice: "অপশনটি সঠিক নয়",
    market_not_found: "প্রশ্নটি পাওয়া যায়নি",
    already_checked_in: "আজকের চেক-ইন আগেই হয়ে গেছে",
    not_joined: "আপনি এখনো জয়েন করেননি। জয়েন করে আবার যাচাই করুন",
    not_claimable: "এই পুরস্কার এখন নেওয়া যাবে না",
    not_available_yet: "এই টাস্ক শীঘ্রই আসছে",
    withdrawal_in_progress: "আগের উইথড্রয়াল অনুরোধ এখনো চলছে",
    under_review: "আপনার অ্যাকাউন্ট যাচাইয়ের অধীনে আছে, সাপোর্টে যোগাযোগ করুন",
    rate_unavailable: "আজকের টোকেন রেট এখনো নির্ধারিত হয়নি, পরে চেষ্টা করুন",
    insufficient_tokens: "যথেষ্ট টোকেন নেই",
    amount_too_small: "পরিমাণ খুব কম",
    bad_request: "তথ্য ঠিক নেই, আবার দেখুন",
    unauthorized: "আবার লগইন করতে অ্যাপটি নতুন করে খুলুন",
    forbidden: "এই অ্যাকাউন্টটি বন্ধ আছে",
};

const FN = {
    insufficient_points: (d) => `যথেষ্ট পয়েন্ট নেই (আছে ${d.have}, লাগবে ${d.need})`,
    below_minimum: (d) => `ন্যূনতম ${d.min} টোকেন লাগবে`,
    not_enough_predictions: (d) => `উইথড্রয়ালের আগে কমপক্ষে ${d.need}টি প্রেডিকশন করুন`,
    account_too_new: (d) =>
        `অ্যাকাউন্ট নতুন। ${new Date(d.availableAt).toLocaleDateString("bn-BD")} এর পর উইথড্রয় করতে পারবেন`,
};

export function msg(e) {
    if (FN[e?.code]) return FN[e.code](e.data || {});
    return TEXT[e?.code] || "কিছু একটা ভুল হয়েছে, আবার চেষ্টা করুন";
}

export const DIFF = { EASY: "সহজ", MEDIUM: "মাঝারি", HARD: "কঠিন" };
export const PRED_STATUS = {
    PENDING: "অপেক্ষমাণ",
    WON: "জিতেছেন ✓",
    LOST: "মেলেনি",
    REFUNDED: "ফেরত",
};
export const WD_STATUS = {
    PENDING: "অপেক্ষমাণ",
    PROCESSING: "প্রক্রিয়াধীন",
    PAID: "পরিশোধিত ✓",
    REJECTED: "বাতিল",
};
export const LEVEL = {
    BRONZE: "🥉 ব্রোঞ্জ",
    SILVER: "🥈 সিলভার",
    GOLD: "🥇 গোল্ড",
    DIAMOND: "💎 ডায়মন্ড",
};