-- ZAXIRA YO'L (Node.js ishlamasa, masalan Windows 7): bazaning TUZILISHI, bemor ma'lumoti EMAS.
-- phpMyAdmin -> chapda MedPlus bazasini tanlang -> "SQL" -> shu so'rovni qo'ying -> "Вперёд/Go"
-- -> natija ostidagi "Экспорт/Export" -> format CSV -> faylni Med.uz.ai jamoasiga yuboring.
SELECT VERSION() AS server_version, c.table_name, t.table_rows AS approx_rows, t.table_collation,
       c.ordinal_position, c.column_name, c.column_type, c.column_key, c.is_nullable
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
 WHERE c.table_schema = DATABASE() AND t.table_type = 'BASE TABLE'
 ORDER BY c.table_name, c.ordinal_position;
