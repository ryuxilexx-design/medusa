export type Role = 'manager' | 'registrar' | 'doctor' | 'cashier' | 'lab';
export const ROLE_LABEL: Record<Role, string> = {
  manager: 'Rahbar', registrar: 'Registrator', doctor: 'Shifokor', cashier: 'Kassir', lab: 'Laboratoriya',
};

export type AppointmentStatus = 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Rejalashtirilgan', arrived: 'Keldi', in_progress: 'Qabulda', completed: 'Yakunlangan', cancelled: 'Bekor qilingan', no_show: 'Kelmadi',
};

export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'paid' | 'void';
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'To‘lanmagan', partially_paid: 'Qisman to‘langan', paid: 'To‘langan', void: 'Bekor qilingan',
};

export type OrderStatus = 'ordered' | 'sample_collected' | 'draft_result' | 'verified' | 'completed' | 'cancelled';
export const LAB_STATUS_LABEL: Record<string, string> = {
  ordered: 'Buyurtma berildi', sample_collected: 'Namuna olindi', draft_result: 'Natija qoralama', verified: 'Tasdiqlangan', cancelled: 'Bekor qilingan',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Naqd', card: 'Karta', transfer: 'O‘tkazma' };
export const SERVICE_CATEGORY_LABEL: Record<string, string> = {
  consultation: 'Konsultatsiya', lab: 'Laboratoriya', ultrasound: 'UZI', procedure: 'Muolaja',
};
export const SEX_LABEL: Record<string, string> = { male: 'Erkak', female: 'Ayol', unspecified: 'Ko‘rsatilmagan' };
export const ALLERGY_LABEL: Record<string, string> = {
  known: 'Ma’lum allergiya qayd etilgan', denied: 'Bemor inkor etadi', unknown: 'Ma’lumot kiritilmagan',
};
