import type { IndicatorSeed } from "./types";


// ─── Education pack (4) ────────────────────────────────────────────────────

export const educationIndicators: IndicatorSeed[] = [
  {
    code: "EDU_ENROLLMENT_FILL",
    nameEn: "Enrollment Fill Rate",
    nameAz: "Qeydiyyat Dolgusu",
    nameRu: "Заполненность набора",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "enrolled_students / target_enrollment * 100",
    thresholds: {
      green: { op: ">=", value: 95 },
      amber: { op: ">=", value: 80 },
      red: { op: "<", value: 80 },
    },
    hintTemplateEn:
      "Enrollment fill {value}%. Below 80% usually signals a pricing or reputation issue relative to competitors — fixed costs don't scale down.",
    hintTemplateRu:
      "Заполняемость зачисления {value}%. Ниже 80% — обычно сигнал pricing или репутации относительно конкурентов.",
    hintTemplateAz:
      "Qeydiyyat doluluğu {value}%. 80%-dən aşağı — adətən rəqiblərlə müqayisədə qiymətləmə və ya reputasiya siqnalıdır.",
    requiredInputs: [
      "operationalFact:enrolled_students",
      "operationalFact:target_enrollment",
    ],
    sortOrder: 510,
  },
  {
    code: "EDU_TUITION_COLLECTION",
    nameEn: "Tuition Collection Rate",
    nameAz: "Təhsil Haqqı Toplanma",
    nameRu: "Собираемость обучения",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "tuition_collected / tuition_billed * 100",
    thresholds: {
      green: { op: ">=", value: 96 },
      amber: { op: ">=", value: 90 },
      red: { op: "<", value: 90 },
    },
    hintTemplateEn:
      "Tuition collection {value}%. Below 90% means arrears are building — tighten payment terms or risk cash-flow crunch.",
    hintTemplateRu:
      "Сбор обучения {value}%. Ниже 90% — задолженность растёт; ужесточите payment terms или risk cascade.",
    hintTemplateAz:
      "Təhsil haqqı yığımı {value}%. 90%-dən aşağı — borclar artır; ödəniş şərtlərini sərtləşdirin və ya risk kaskadı.",
    requiredInputs: [
      "operationalFact:tuition_collected",
      "operationalFact:tuition_billed",
    ],
    sortOrder: 520,
  },
  {
    code: "EDU_GROSS_MARGIN",
    nameEn: "Education Gross Margin",
    nameAz: "Təhsil Ümumi Marja",
    nameRu: "Валовая маржа образования",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 40 },
      amber: { op: ">=", value: 20 },
      red: { op: "<", value: 20 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Private education baselines 40-55%; below 20% means teacher cost + facility cost nearly equal tuition revenue.",
    hintTemplateRu:
      "Валовая маржа {value}%. Частное образование baseline 40–55%; ниже 20% — teacher cost + facility перевешивают tuition revenue.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Özəl təhsil baseline 40–55%; 20%-dən aşağı — müəllim xərci + tikili təhsil haqqı gəlirini üstələyir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 530,
    weight: 1.4, // Core profitability
  },
  {
    code: "EDU_STUDENT_TEACHER_RATIO",
    nameEn: "Student-Teacher Ratio",
    nameAz: "Tələbə/Müəllim Nisbəti",
    nameRu: "Соотношение студент/учитель",
    category: "operational",
    industries: ["education"],
    unit: "ratio",
    direction: "band",
    formula: "enrolled_students / teachers",
    thresholds: {
      green: { op: "between", value: [10, 20] },
      amber: { op: "between", value: [6, 25] },
      red: { op: ">", value: 25 },
    },
    hintTemplateEn:
      "Student-teacher ratio {value}. Sweet spot 10-20; above 25 erodes quality, 6-10 suggests over-staffing.",
    hintTemplateRu:
      "Соотношение студент-учитель {value}. Sweet spot 10–20; выше 25 эродирует качество, 6–10 — over-staffing.",
    hintTemplateAz:
      "Tələbə-müəllim nisbəti {value}. Sweet spot 10–20; 25-dən yuxarı keyfiyyəti aşır, 6–10 — həddən artıq personal.",
    requiredInputs: [
      "operationalFact:enrolled_students",
      "operationalFact:teachers",
    ],
    sortOrder: 540,
  },
];
