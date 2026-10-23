export type Role = 'manager' | 'registrar' | 'doctor' | 'cashier' | 'lab';
export const ROLE_LABEL: Record<Role, string> = {
  manager: 'Rahbar', registrar: 'Registrator', doctor: 'Shifokor', cashier: 'Kassir', lab: 'Laboratoriya',
};

export type AppointmentStatus = 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Rejalashtirilgan', arrived: 'Keldi', in_progress: 'Qabulda', completed: 'Yakunlangan', cancelled: 'Bekor qilingan', no_show: 'Kelmadi',
};

export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'paid' | 'refunded' | 'void';
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'To‘lanmagan', partially_paid: 'Qisman to‘langan', paid: 'To‘langan', refunded: 'Qaytarilgan', void: 'Bekor qilingan',
};

export type OrderStatus = 'ordered' | 'sample_collected' | 'draft_result' | 'verified' | 'completed' | 'cancelled';
export const LAB_STATUS_LABEL: Record<string, string> = {
  ordered: 'Buyurtma berildi', sample_collected: 'Namuna olindi', draft_result: 'Natija qoralama', verified: 'Tasdiqlangan', cancelled: 'Bekor qilingan',
};

/** Ways money actually arrives (choices for a cashier); 'deposit' is a payment covered from the patient's prepayment. */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;
export const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Naqd', card: 'Karta', transfer: 'O‘tkazma', deposit: 'Depozitdan' };
export const SERVICE_CATEGORY_LABEL: Record<string, string> = {
  consultation: 'Konsultatsiya', lab: 'Laboratoriya', ultrasound: 'UZI', procedure: 'Muolaja',
};
export const SEX_LABEL: Record<string, string> = { male: 'Erkak', female: 'Ayol', unspecified: 'Ko‘rsatilmagan' };
export const ALLERGY_LABEL: Record<string, string> = {
  known: 'Ma’lum allergiya qayd etilgan', denied: 'Bemor inkor etadi', unknown: 'Ma’lumot kiritilmagan',
};

export const REFUND_REASON_LABEL: Record<string, string> = {
  service_not_provided: 'Xizmat ko‘rsatilmadi', appointment_cancelled: 'Qabul bekor qilindi', patient_complaint: 'Bemor shikoyati', other: 'Boshqa sabab',
};
export const EXPENSE_CATEGORIES = ['Ijara', 'Maosh', 'Kommunal', 'Reagentlar', 'Tibbiy sarf materiallari', 'Xo‘jalik', 'Ta’mirlash', 'IT xizmatlari', 'Marketing', 'Soliq va to‘lovlar', 'Boshqa'] as const;
export const EXPENSE_PAID_FROM_LABEL: Record<string, string> = { cash_drawer: 'Kassadan (naqd)', bank: 'Bank hisobidan', card: 'Korporativ karta', other: 'Boshqa' };
