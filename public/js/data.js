// ===== 정적 데이터 =====

// 관리자가 어느 시각을 열어도 고를 수 있도록 하루 전체를 빈틈없이 덮는다.
const SLOTS = [
  { key: "아침",   from: 7,  to: 10, label: "7~10시" },
  { key: "브런치", from: 10, to: 12, label: "10~12시" },
  { key: "점심",   from: 12, to: 15, label: "12~15시" },
  { key: "점저",   from: 15, to: 18, label: "15~18시" },
  { key: "저녁",   from: 18, to: 20, label: "18~20시" },
  { key: "밤",     from: 20, to: 24, label: "20~24시" },
  { key: "새벽",   from: 0,  to: 7,  label: "0~7시" },
];

const PARTY_LABELS = {
  hyunwoo: "박현우",
  minseok: "박민석",
  both: "박현우 · 박민석",
};

// 운동 종목
const SPORTS = [
  { name: "배드민턴", emoji: "🏸" },
  { name: "탁구", emoji: "🏓" },
  { name: "볼링", emoji: "🎳" },
  { name: "헬스", emoji: "💪" },
  { name: "러닝", emoji: "🏃" },
  { name: "자전거", emoji: "🚴" },
];
