export type MemberColor = "asagi" | "momo" | "yamabuki" | "wakatake"

export type Member = {
  id: string
  name: string
  shortName: string
  color: MemberColor
  isSelf?: boolean
}

export type SyncState = "synced" | "pending" | "conflict"

export type CalendarEvent = {
  key: string
  title: string | null
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  memberIds: string[]
  forEveryone: boolean
  location?: string
  recurrenceLabel?: string
  isPrivate: boolean
  sync: SyncState
  isNew?: boolean
  changeLabel?: string
}

export const members: Member[] = [
  { id: "father", name: "お父さん", shortName: "父", color: "asagi" },
  { id: "mother", name: "お母さん", shortName: "母", color: "momo" },
  {
    id: "haruto",
    name: "はると",
    shortName: "は",
    color: "yamabuki",
    isSelf: true,
  },
  { id: "saki", name: "さき", shortName: "さ", color: "wakatake" },
]

const everyone = members.map((member) => member.id)

export const events: CalendarEvent[] = [
  {
    key: "beauty",
    title: "美容院",
    allDay: false,
    startDate: "2026-09-26",
    endDate: "2026-09-26",
    startTime: "13:00",
    endTime: "14:30",
    memberIds: ["saki"],
    forEveryone: false,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "yoga",
    title: "ヨガ",
    allDay: false,
    startDate: "2026-09-27",
    endDate: "2026-09-27",
    startTime: "10:00",
    endTime: "11:30",
    memberIds: ["mother"],
    forEveryone: false,
    recurrenceLabel: "毎週 日",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "gym",
    title: "ジム",
    allDay: false,
    startDate: "2026-09-27",
    endDate: "2026-09-27",
    startTime: "15:00",
    endTime: "16:30",
    memberIds: ["haruto"],
    forEveryone: false,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "dinner",
    title: "おばあちゃんの家で夕食",
    allDay: false,
    startDate: "2026-09-27",
    endDate: "2026-09-27",
    startTime: "18:00",
    endTime: "20:00",
    memberIds: everyone,
    forEveryone: true,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "trip-tokyo",
    title: "出張（東京）",
    allDay: true,
    startDate: "2026-09-28",
    endDate: "2026-09-30",
    startTime: null,
    endTime: null,
    memberIds: ["father"],
    forEveryone: false,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "burnable",
    title: "燃えるゴミ",
    allDay: false,
    startDate: "2026-09-28",
    endDate: "2026-09-28",
    startTime: "07:30",
    endTime: null,
    memberIds: everyone,
    forEveryone: true,
    recurrenceLabel: "毎週 月・木",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "dentist",
    title: "歯医者",
    allDay: false,
    startDate: "2026-09-28",
    endDate: "2026-09-28",
    startTime: "19:30",
    endTime: "20:30",
    memberIds: ["haruto"],
    forEveryone: false,
    location: "駅前歯科",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "movie",
    title: "映画",
    allDay: false,
    startDate: "2026-09-30",
    endDate: "2026-09-30",
    startTime: "20:00",
    endTime: "22:10",
    memberIds: ["mother", "saki"],
    forEveryone: false,
    isPrivate: false,
    sync: "pending",
    isNew: true,
    changeLabel: "お母さんが3分前に追加",
  },
  {
    key: "english",
    title: "オンライン英会話",
    allDay: false,
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    startTime: "21:00",
    endTime: "21:45",
    memberIds: ["haruto"],
    forEveryone: false,
    recurrenceLabel: "毎週 木",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "golf",
    title: "ゴルフ",
    allDay: false,
    startDate: "2026-10-03",
    endDate: "2026-10-03",
    startTime: "07:00",
    endTime: "15:00",
    memberIds: ["father"],
    forEveryone: false,
    location: "〇〇カントリークラブ",
    isPrivate: false,
    sync: "synced",
    isNew: true,
    changeLabel: "お父さんが時刻を変更",
  },
  {
    key: "saki-private",
    title: null,
    allDay: false,
    startDate: "2026-10-03",
    endDate: "2026-10-03",
    startTime: "14:00",
    endTime: "16:00",
    memberIds: ["saki"],
    forEveryone: false,
    isPrivate: true,
    sync: "synced",
  },
  {
    key: "shopping",
    title: "まとめ買い",
    allDay: false,
    startDate: "2026-10-04",
    endDate: "2026-10-04",
    startTime: "11:00",
    endTime: "13:00",
    memberIds: ["mother", "haruto"],
    forEveryone: false,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "present",
    title: "プレゼント選び",
    allDay: false,
    startDate: "2026-10-09",
    endDate: "2026-10-09",
    startTime: "19:00",
    endTime: "20:00",
    memberIds: ["haruto"],
    forEveryone: false,
    isPrivate: true,
    sync: "synced",
  },
  {
    key: "kanazawa",
    title: "家族旅行（金沢）",
    allDay: true,
    startDate: "2026-10-10",
    endDate: "2026-10-12",
    startTime: null,
    endTime: null,
    memberIds: everyone,
    forEveryone: true,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "birthday",
    title: "お母さんの誕生日",
    allDay: true,
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    startTime: null,
    endTime: null,
    memberIds: ["mother"],
    forEveryone: false,
    recurrenceLabel: "毎年",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "recycle",
    title: "資源ゴミ",
    allDay: false,
    startDate: "2026-10-14",
    endDate: "2026-10-14",
    startTime: "07:30",
    endTime: null,
    memberIds: everyone,
    forEveryone: true,
    recurrenceLabel: "毎月 第2・第4 水",
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "fishing",
    title: "夜釣り",
    allDay: false,
    startDate: "2026-10-15",
    endDate: "2026-10-16",
    startTime: "22:00",
    endTime: "01:00",
    memberIds: ["father"],
    forEveryone: false,
    isPrivate: false,
    sync: "synced",
  },
  {
    key: "moving",
    title: "引っ越しの手伝い",
    allDay: false,
    startDate: "2026-10-17",
    endDate: "2026-10-17",
    startTime: "09:00",
    endTime: "12:00",
    memberIds: ["saki", "haruto"],
    forEveryone: false,
    isPrivate: false,
    sync: "conflict",
  },
]

export const holidays: Record<string, string> = {
  "2026-09-21": "敬老の日",
  "2026-09-22": "国民の休日",
  "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日",
}
