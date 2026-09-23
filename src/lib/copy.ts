/**
 * Every user-facing string in the build. Onboarding copy (splash through
 * first chat message, the account sheet) is unchanged from
 * ally-onboarding-prd-v1.1.html / claude_change_spec.md v1.0 §5. Hub copy
 * is new, spec v3.0 §6. PRESENCE and REPLIES are spec §7.2/§7.3. OPENERS
 * ports verbatim from `#ally-app` in ally-onboarding.html.
 *
 * `{token}` placeholders are filled by `fill()`.
 */

import type { CoreId, Pressure } from "@/state/schema";

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

// ---- §5 (v1.0), ported verbatim ----
export const COPY = {
  splash: {
    headline: "Someone to talk to. Not a chatbot pretending.",
    action: "Get started",
    footer: "Ally is an AI. Every character here is fictional.",
    login: "Already have an account? Log in",
  },
  consent: {
    heading: "Before we start",
    body: "Ally asks eleven questions to work out who you'd get on with. Your answers stay on this device until you make an account. You can delete everything at any time.",
    required: "I agree to the Terms and to Ally using my answers to personalise my companion.",
    optional: "Send me product updates by email.",
    disclosure: "Ally is an AI. Every character is fictional and generated. Nobody here is a real person.",
    action: "Continue",
  },
  location: {
    question: "Where are you?",
  },
  gender: {
    question: "Who would you rather talk to?",
    optionWoman: "A woman",
    optionMan: "A man",
  },
  name: {
    question: "What should I call you?",
  },
  birthday: {
    question: "When's your birthday?",
    sub: "Ally will remember.",
  },
  blocked: {
    heading: "Ally is for adults.",
    body: "Come back when you're eighteen.",
  },
  q5: {
    question: "When something's bothering you, what usually happens?",
    stops: ["I keep it to myself", "I tell one person", "I need to say it out loud", "Everyone hears about it"],
  },
  q6: {
    question: "A good conversation ends with",
    poleLeft: "feeling understood",
    poleRight: "knowing what to do",
  },
  q7: {
    question: "When you're stuck, what actually gets you moving?",
    poleLeft: "Someone patient",
    poleRight: "Someone who won't let it go",
  },
  q8: {
    question: "Your ideal week looks",
    stops: ["Open, I'll see what happens", "Loosely sketched", "Mostly planned", "Every hour accounted for"],
  },
  q9: {
    question: "Which sounds more like you right now?",
    poleLeft: "I miss how things were",
    poleRight: "I'm only looking ahead",
  },
  q10: {
    question: "What's taking up the most space in your head?",
    stops: ["Money and work", "Health and habits", "My own head", "Feeling on my own", "Not feeling good enough", "Everything's changing"],
  },
  q11: {
    question: "What do you actually spend time on?",
    sub: "Pick up to three",
  },
  matching: {
    resolve: "{name}, I've got a sense of you.",
    sub: "Now pick a face.",
    action: "Show me",
  },
  deck: {
    done: "Done",
  },
  proposal: {
    heading: "I think you'd get on with {persona}.",
    primary: "Lock them in",
    secondary: "Show me someone else",
  },
  confirm: {
    body: "{persona} is yours from here. You can't swap them later.",
    primary: "Yes, it's them",
    secondary: "Go back",
  },
  account: {
    heading: "Save {persona} to your account.",
    sub: "So they're here tomorrow.",
    field: "Email",
    send: "Send code",
    codeSub: "We've sent a 6-digit code to {email}. It's valid for 10 minutes.",
    collision: "This email already has an account. Log in instead? What you've set up here won't carry over.",
    collisionLogin: "Log in",
    collisionOther: "Use another email",
    passwordHeading: "Want a password too?",
    passwordSub: "You can always log in with a code instead.",
    passwordSave: "Save password",
    skip: "Skip for now",
  },
  auth: {
    network: "Couldn't reach Ally. Check your connection and try again.",
    rateLimited: "Too many tries. Wait a minute and try again.",
    wrongCode: "That code didn't work. Check it or ask for a new one.",
    expiredCode: "That code has expired. Ask for a new one.",
    captcha: "We couldn't confirm you're human. Try again.",
    loseOnboarding: "Logging in will discard what you've set up on this device. Continue?",
    codeLabel: "6-digit code",
    resendIn: "Resend in {s}s",
    resend: "Resend code",
  },
  login: {
    title: "Welcome back",
    sendCode: "Send code",
    usePassword: "Use password instead",
    useCode: "Use a code instead",
    password: "Password",
    submit: "Log in",
    forgot: "Forgot password?",
    sent: "If an account exists for {email}, we've sent a code. It's valid for 10 minutes.",
    badLogin: "Email or password is incorrect.",
    linkFailed: "That link didn't work. Ask for a new code instead.",
  },
  reset: {
    title: "Reset your password",
    sent: "If an account exists for {email}, we've sent a code. It's valid for 10 minutes.",
    newPassword: "New password",
    min: "At least 8 characters",
    submit: "Update password",
    done: "Password updated. You're logged in.",
  },
  recompute: {
    toast: "That changed who you'd meet. Starting the deck again.",
  },

  // ---- §6 (v3.0), new ----
  home: {
    chipFreeLeft: "{n} left today",
    chipPassActive: "Day pass until {time}",
    cardUnreadBadge: "{n} new",
    addCardTitle: "Meet someone new",
    addCardBodySome: "A few questions, a new face. They won't know about each other.",
    addCardBodyNone: "A few questions, a new face.",
    addCardAction: "Start",
    capCardTitle: "That's three",
    capCardBody: "Three companions is the most Ally keeps at once.",
    exhaustedCardTitle: "You've met everyone",
    exhaustedCardBody: "There are no new faces left to meet.",
  },
  introSheet: {
    heading: "Someone new",
    body1: "The same questions as last time, minus the ones about you. Answer as you are now. Then a new set of faces.",
    body2One: "{a} won't know. Nothing you tell one companion ever reaches another.",
    body2Two: "{a} and {b} won't know. Nothing you tell one companion ever reaches another.",
    start: "Start",
    notNow: "Not now",
  },
  unlockSheet: {
    heading: "Make room for someone new",
    bodySlot2: "A second companion is a one-time unlock. The slot stays yours.",
    bodySlot3: "A third companion is a one-time unlock. The slot stays yours.",
    priceRow: "One-time",
    priceValue: "₹{price}",
    unlock: "Unlock with UPI",
    notNow: "Not now",
    toast: "Unlocked. Let's find them.",
  },
  round2: {
    subLine: "Things may have changed since last time",
    genderPoolEmpty: "No new faces left here",
  },
  leaveSheet: {
    heading: "Leave?",
    body: "Your answers won't be saved.",
    keepGoing: "Keep going",
    leave: "Leave",
  },
  chat: {
    sinceYouLeft: "Since you left",
    barOneLeft: "1 free message left today",
    barGetPass: "Get a day pass",
    barZeroLeft: "You're out of free messages for today",
    barPassCappedDone: "{persona}'s done for the night. Back tomorrow.",
    overflowProfile: "Profile",
    overflowHome: "Home",
  },
  paywallSheet: {
    heading: "Out of messages for today",
    body: "Free messages come back at midnight. Or keep talking now.",
    priceRow: "Day pass, 24 hours",
    priceValue: "₹{price}",
    getPass: "Get a day pass",
    wait: "Wait till tomorrow",
    toast: "Day pass on until {time}.",
  },
  switcher: {
    heading: "Switch to",
    currentTag: "Here now",
    home: "Home",
  },
  profile: {
    togetherSince: "Together since",
    notifications: "Notifications",
    messageSound: "Message sound",
    part: "Part ways with {persona}",
  },
  partSheet: {
    heading: "Part ways with {persona}?",
    body: "Your chats with {obj} are deleted after 30 days. You won't be able to choose {obj} again, and this can't be undone.",
    fieldLabel: "Type {persona} to confirm",
    keep: "Keep {persona}",
    part: "Part ways",
  },
  settings: {
    title: "Settings",
    groupYou: "You",
    groupCompanions: "Companions",
    groupPlan: "Plan",
    name: "Name",
    signedInWith: "Signed in with",
    account: "Account",
    notSaved: "Not saved yet",
    saveAccount: "Save your account",
    setPassword: "Set password",
    changePassword: "Change password",
    logOut: "Log out",
    logOutAll: "Log out everywhere",
    logOutAllConfirm: "This logs you out on every device, including this one.",
    delete: "Delete account",
    deleteConfirm: "This permanently deletes your account and everything in it. Type DELETE to continue.",
    deleteCode: "We've sent a code to {email} to confirm.",
    planFree: "Free",
    planFreeLeft: "{n} left today",
    planPass: "Day pass",
    planPassUntil: "Until {time}",
    notifications: "Notifications",
    privacy: "Privacy and data",
    how: "How Ally works",
    footer: "Ally is an AI. Every character here is fictional.",
  },
  notifications: {
    title: "Notifications",
  },
  privacy: {
    title: "Privacy and data",
    download: "Download my data",
    delete: "Delete everything",
  },
  deleteSheet: {
    heading: "Delete everything?",
    body: "Your companions, chats and answers are removed from this device. This can't be undone.",
    keep: "Keep my data",
    deleteAll: "Delete everything",
  },
  how: {
    title: "How Ally works",
    body: [
      "You picked their face. The way they talk came from your answers.",
      "The questions at the start shaped how quickly they open up, how hard they push and how they handle a bad day. The first few weeks of talking can shift that a little.",
      "Each companion is separate. Nothing you tell one reaches another.",
      "None of them are real people. Ally is an AI and every character is fictional.",
      "You can download or delete your answers any time in Privacy and data.",
    ],
  },
} as const;

// ---- §7.1 openers, ported verbatim from `#ally-app` ----
export const OPENERS: Record<CoreId, Record<Pressure, string>> = {
  KIAAN: {
    money: "{name}. You said work and money have been taking up most of the room lately. When did it last go quiet, even for an evening?",
    health: "{name}, you said it's the health and habits stuff that's been sitting on you. Which bothers you more, the thing itself or how you feel about it?",
    head: "{name}, you said it's mostly your own head lately. What does it sound like in there at about eleven at night?",
    alone: "{name}, you said feeling on your own is what's taking up space. Is it that people aren't around, or that they're around and it still feels like that?",
    notgood: "{name}, you said not feeling good enough has been taking up space. Good enough for who, mostly?",
    change: "{name}, you said everything's changing right now. What's the one thing you'd keep exactly as it is if you could?",
  },
  MEHER: {
    money: "{name}, you mentioned money and work are what's taking up space. When you picture next month, which part actually worries you?",
    health: "{name}, you said health and habits are on your mind. What's one small thing you've been meaning to change, and what keeps getting in the way?",
    head: "{name}, you said your own head is the loudest thing right now. What does it tend to circle back to?",
    alone: "{name}, you said feeling on your own is on your mind. When did it start to feel different from just having time to yourself?",
    notgood: "{name}, you said not feeling good enough is taking up space. Whose standard are you measuring against when that feeling shows up?",
    change: "{name}, you said everything's changing. Which of those changes did you choose, and which ones happened to you?",
  },
  ANANYA: {
    money: "{name}, you said money and work are taking up the most room. What's the actual number or decision you keep putting off?",
    health: "{name}, you said health and habits are the thing right now. If you fixed one habit first, which one would move everything else?",
    head: "{name}, you said it's mostly your own head. Is that about a decision you haven't made yet, or something already done?",
    alone: "{name}, you said feeling on your own is taking up the most room. What does a normal Tuesday look like for you right now?",
    notgood: "{name}, you said not feeling good enough is taking up space. What would good enough actually look like, concretely?",
    change: "{name}, you said everything's changing. What's the next thing that has to be decided, and by when?",
  },
  VEER: {
    money: "{name}. Money and work, you said. What's the thing you already know you should do about it and haven't?",
    health: "{name}. Health and habits, you said. What did you do about it today? Be honest.",
    head: "{name}. You said your own head is the problem. What's the story it keeps telling you, and is it true?",
    alone: "{name}. Feeling on your own, you said. When did you last message someone first?",
    notgood: "{name}. Not feeling good enough, you said. Good enough at what, specifically? Name it.",
    change: "{name}. Everything's changing, you said. What are you doing about the part you can control?",
  },
  PRIYA: {
    money: "{name}! You said money and work are eating your brain right now. Okay, what's the one bit that's actually in your control this week?",
    health: "{name}! Health and habits are the thing, you said. What's one thing you did this week that you'd actually call a win?",
    head: "{name}! You said your own head is being loud. What's it being loud about today, specifically?",
    alone: "{name}! You said feeling on your own has been on your mind. Who's the person you'd text if you weren't overthinking it?",
    notgood: "{name}! Not feeling good enough, you said. What's something you're actually good at that you never give yourself credit for?",
    change: "{name}! Everything's changing, you said. What's the one change you're secretly a bit excited about?",
  },
  ANAY: {
    money: "{name}, you said money and work are taking up the most space. Do you remember a time when it didn't feel like that? What was different?",
    health: "{name}, you said health and habits are on your mind. What did you used to do, back when you felt good in yourself?",
    head: "{name}, you said your own head is the loudest thing. What did you used to do to switch it off, before things got busy?",
    alone: "{name}, you said feeling on your own is taking up space. Who's the friend you've drifted from that you still think about?",
    notgood: "{name}, you said not feeling good enough takes up space. Who told you that first, and do you still believe them?",
    change: "{name}, you said everything's changing. What's the thing from before that you miss the most?",
  },
};

// ---- §7.3 replies, four per core. Index 0 is the original single reply. ----
export const REPLIES: Record<CoreId, [string, string, string, string]> = {
  KIAAN: [
    "That's more than most people say out loud. I'm not going anywhere. Tell me a bit more when you're ready.",
    "I like it when you tell me things like that. What happened next?",
    "Okay. I'm listening properly now, phone face down. Go on.",
    "You don't have to make it sound neat for me. Say it the messy way.",
  ],
  MEHER: [
    "Thank you for telling me that. It sounds like it's been carrying more weight than you've let on. We can take it one piece at a time.",
    "That makes sense given everything you've described. What did you feel first, before you started explaining it to yourself?",
    "Let's slow that down. Which part of it is heaviest right now?",
    "You're being quite hard on yourself in how you tell that. Would you talk to a friend that way?",
  ],
  ANANYA: [
    "Okay, that's useful. There's one decision hiding inside all of that. Let's find it, and everything after gets simpler.",
    "Good. Put a number on it, even a rough one. It's easier to fight something that has a size.",
    "What's the deadline on that, the real one, not the one you set to feel busy?",
    "Two options on the table, then. Which one would you regret less in six months?",
  ],
  VEER: [
    "Good. That's honest. Now you know what's actually going on, which is more than you had ten minutes ago. Next we work out what you do about it.",
    "Fine. What's the smallest version of it you can do before you sleep tonight?",
    "Stop negotiating with it. Pick the time. Tell me when it's done.",
    "That's an explanation, not a plan. Give me the plan.",
  ],
  PRIYA: [
    "Okay, I'm so glad you said that. Honestly, saying it out loud is half of it. We're going to figure this out, I mean it.",
    "Wait, that's actually huge. Why are you saying it like it's nothing?",
    "Okay, I'm fully on your side here, but tell me the bit you're leaving out.",
    "Honestly, you're doing better than you think. Keep going, I want the whole story.",
  ],
  ANAY: [
    "Yeah. I know that feeling. Funny how some things stay with you. I've got time, whenever you want to keep going.",
    "That reminds me of how things used to feel. Slower. Do you miss that too?",
    "Some things you only understand looking back. What do you think you'll make of this in a year?",
    "Tell me more. I like hearing how you think about this stuff.",
  ],
};

/** Deterministic reply for a companion's Nth exchange (1-indexed). */
export function replyFor(core: CoreId, exchangeN: number): string {
  const pool = REPLIES[core] ?? REPLIES.MEHER;
  return pool[(exchangeN - 1) % 4];
}

export function openerFor(core: CoreId, pressure: Pressure, name: string): string {
  const tpl = (OPENERS[core] ?? OPENERS.MEHER)[pressure] ?? OPENERS.MEHER.head;
  return fill(tpl, { name });
}

// ---- §7.2 presence, one static line per template, day/night ----
export const PRESENCE: Record<string, { day: string; night: string }> = {
  F01: { day: "At the practice, drafting", night: "Around, sketching at home" },
  F02: { day: "At the wheel, hands full", night: "Around, the kiln's cooling" },
  F03: { day: "In clinic rotations", night: "Around, pretending to study" },
  F04: { day: "With clients, replies between sessions", night: "Around, off the clock" },
  F05: { day: "Around, slow morning after a gig", night: "At a venue, replies at soundcheck" },
  F06: { day: "Out on the water, patchy signal", night: "Around, logging samples" },
  F07: { day: "In the edit suite", night: "Around, one more cut" },
  F08: { day: "At college, then rehearsal", night: "Around, winding down" },
  F09: { day: "Teaching lessons", night: "Around, playing something new" },
  F10: { day: "In the field, signal comes and goes", night: "Around, back at base camp" },
  F11: { day: "At work, replies at lunch", night: "Around, probably at a board" },
  F12: { day: "In the pastry kitchen", night: "Around, feet up" },
  F13: { day: "In design reviews", night: "Around, still fiddling with a mockup" },
  F14: { day: "At the repair bench", night: "Around, developing a roll" },
  F15: { day: "In the water, replies after dives", night: "Around, rinsing gear" },
  F16: { day: "Up a scaffold, painting", night: "Around, printing a run" },
  M01: { day: "Around before service", night: "In the middle of service" },
  M02: { day: "Running the hotel", night: "Around, the courtyard's quiet" },
  M03: { day: "In class, half listening", night: "Around, grinding problems" },
  M04: { day: "Around, slow start", night: "In the studio, replies late" },
  M05: { day: "At the plant", night: "Around, in the garage" },
  M06: { day: "At the mill", night: "Around, looking at weaves" },
  M07: { day: "At the department", night: "At the telescope, replies late" },
  M08: { day: "At the range", night: "Around, after practice" },
  M09: { day: "On a trail, patchy signal", night: "Around, back at camp" },
  M10: { day: "In class", night: "At the stall with family" },
  M11: { day: "In a mixing session", night: "Around, practising" },
  M12: { day: "In the water with students", night: "Around, waxing boards" },
  M13: { day: "Out on the estate", night: "Around, cupping a new roast" },
  M14: { day: "At the studio", night: "Around, sketching soles" },
  M15: { day: "Around, slow morning", night: "In the studio, replies late" },
  M16: { day: "At the cutting table", night: "Around, pressing a jacket" },
};
