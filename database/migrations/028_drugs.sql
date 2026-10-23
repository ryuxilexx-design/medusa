-- Drug reference, allergy classes and the patient's structured allergy list (audit 2026-10-22: the «Dori tavsiyasi»
-- was free text with no allergy check). See docs/DRUGS.md for the source, licence and clinical-review status.
--
-- drugs              global reference like icd10_codes (generic INN names only). The starter list
--                    (database/seed/drugs.csv, source 'starter') is loaded on migrate while the table is empty;
--                    `npm run db:import-drugs -- file.csv` loads an official list (source 'official').
-- allergy_classes    global: a class (penicillins, NSAIDs …) and the classes it partly cross-reacts with.
-- patient_allergies  per clinic, append + confirm/withdraw only (DB trigger), like patient_consents.
-- The old patients.allergy_state / allergy_note stay as they are; the UI shows both.

CREATE TABLE allergy_classes (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_uz text NOT NULL,
  name_ru text NOT NULL,
  -- partial cross-reactivity: an allergy to this class warns for drugs of these classes (blocks only when severe)
  cross_reactive text[] NOT NULL DEFAULT '{}',
  -- lower-case words (Latin/Cyrillic) that let a free-text allergy («penitsillinga toshma») match this class
  keywords text[] NOT NULL DEFAULT '{}',
  sort int NOT NULL DEFAULT 100
);

INSERT INTO allergy_classes (code, name_uz, name_ru, cross_reactive, keywords, sort) VALUES
  ('penicillins', 'Penitsillinlar', 'Пенициллины', '{cephalosporins,carbapenems}', '{penitsillin,penicillin,пенициллин,пенитсиллин,amoksitsillin,amoxicillin,амоксициллин,ampitsillin,ampicillin,ампициллин,augmentin,аугментин,amoksiklav,амоксиклав}', 10),
  ('cephalosporins', 'Sefalosporinlar', 'Цефалоспорины', '{penicillins,carbapenems}', '{sefalosporin,cephalosporin,цефалоспорин,seftriakson,ceftriaxone,цефтриаксон,sefazolin,cefazolin,цефазолин,sefiksim,cefixime,цефиксим}', 11),
  ('carbapenems', 'Karbapenemlar', 'Карбапенемы', '{penicillins,cephalosporins}', '{karbapenem,carbapenem,карбапенем,meropenem,меропенем}', 12),
  ('monobactams', 'Monobaktamlar', 'Монобактамы', '{}', '{aztreonam,азтреонам}', 13),
  ('sulfonamides', 'Sulfanilamidlar (antibiotiklar)', 'Сульфаниламиды (антибиотики)', '{}', '{sulfanilamid,sulfonamide,сульфаниламид,biseptol,бисептол,ko-trimoksazol,co-trimoxazole,ко-тримоксазол}', 20),
  ('macrolides', 'Makrolidlar', 'Макролиды', '{}', '{makrolid,macrolide,макролид,azitromitsin,azithromycin,азитромицин,klaritromitsin,clarithromycin,кларитромицин,eritromitsin,erythromycin,эритромицин}', 21),
  ('fluoroquinolones', 'Ftorxinolonlar', 'Фторхинолоны', '{}', '{ftorxinolon,fluoroquinolone,фторхинолон,siprofloksatsin,ciprofloxacin,ципрофлоксацин,levofloksatsin,levofloxacin,левофлоксацин,ofloksatsin,ofloxacin,офлоксацин}', 22),
  ('tetracyclines', 'Tetratsiklinlar', 'Тетрациклины', '{}', '{tetratsiklin,tetracycline,тетрациклин,doksitsiklin,doxycycline,доксициклин}', 23),
  ('aminoglycosides', 'Aminoglikozidlar', 'Аминогликозиды', '{}', '{aminoglikozid,aminoglycoside,аминогликозид,gentamitsin,gentamicin,гентамицин,amikatsin,amikacin,амикацин}', 24),
  ('lincosamides', 'Linkozamidlar', 'Линкозамиды', '{}', '{linkomitsin,lincomycin,линкомицин,klindamitsin,clindamycin,клиндамицин}', 25),
  ('nitroimidazoles', 'Nitroimidazollar', 'Нитроимидазолы', '{}', '{metronidazol,metronidazole,метронидазол,tinidazol,tinidazole,тинидазол,ornidazol,орнидазол}', 26),
  ('glycopeptides', 'Glikopeptidlar', 'Гликопептиды', '{}', '{vankomitsin,vancomycin,ванкомицин}', 27),
  ('nitrofurans', 'Nitrofuranlar', 'Нитрофураны', '{}', '{nitrofuran,нитрофуран,furazolidon,фуразолидон,nifuroksazid,нифуроксазид,furagin,фурагин,nitrofurantoin,нитрофурантоин}', 28),
  ('nsaids', 'NYaQVP va aspirin', 'НПВС и аспирин', '{pyrazolones}', '{nyaqvp,nsaid,нпвс,нпвп,aspirin,аспирин,ibuprofen,ибупрофен,diklofenak,diclofenac,диклофенак,ketorolak,ketorolac,кеторолак,nimesulid,nimesulide,нимесулид,meloksikam,meloxicam,мелоксикам,naproksen,напроксен}', 30),
  ('pyrazolones', 'Pirazolonlar (metamizol)', 'Пиразолоны (метамизол)', '{nsaids}', '{metamizol,metamizole,метамизол,analgin,анальгин,baralgin,баралгин}', 31),
  ('opioids', 'Opioidlar', 'Опиоиды', '{}', '{opioid,опиоид,morfin,morphine,морфин,tramadol,трамадол,kodein,codeine,кодеин}', 40),
  ('local_anesthetics_amide', 'Mahalliy anestetiklar (amid)', 'Местные анестетики (амиды)', '{}', '{lidokain,lidocaine,лидокаин,artikain,articaine,артикаин,ultrakain,ультракаин,bupivakain,бупивакаин}', 41),
  ('local_anesthetics_ester', 'Mahalliy anestetiklar (efir)', 'Местные анестетики (эфиры)', '{}', '{novokain,procaine,новокаин,прокаин,benzokain,benzocaine,бензокаин,anestezin,анестезин}', 42),
  ('iodinated_contrast', 'Yodli kontrast moddalar', 'Йодсодержащие контрастные вещества', '{}', '{kontrast,contrast,контраст,iogeksol,iohexol,йогексол}', 43),
  ('ace_inhibitors', 'AAF ingibitorlari (angioshish)', 'Ингибиторы АПФ (ангиоотёк)', '{arbs}', '{апф,enalapril,эналаприл,lizinopril,lisinopril,лизиноприл,kaptopril,captopril,каптоприл,ramipril,рамиприл,perindopril,периндоприл}', 50),
  ('arbs', 'Angiotenzin II retseptor blokatorlari', 'Блокаторы рецепторов ангиотензина II', '{ace_inhibitors}', '{sartan,сартан,losartan,лозартан,valsartan,валсартан}', 51),
  ('statins', 'Statinlar', 'Статины', '{}', '{statin,статин,atorvastatin,аторвастатин,rozuvastatin,rosuvastatin,розувастатин,simvastatin,симвастатин}', 52),
  ('aromatic_anticonvulsants', 'Aromatik antikonvulsantlar', 'Ароматические антиконвульсанты', '{aromatic_anticonvulsants}', '{karbamazepin,carbamazepine,карбамазепин,fenitoin,phenytoin,фенитоин,fenobarbital,phenobarbital,фенобарбитал,lamotrigin,lamotrigine,ламотриджин}', 53),
  ('heparins', 'Geparinlar', 'Гепарины', '{}', '{geparin,heparin,гепарин,enoksaparin,enoxaparin,эноксапарин}', 54),
  ('sulfonylureas', 'Sulfonilmochevina hosilalari', 'Производные сульфонилмочевины', '{}', '{glibenklamid,glibenclamide,глибенкламид,gliklazid,gliclazide,гликлазид,glimepirid,glimepiride,глимепирид}', 55),
  ('thiazides', 'Tiazid diuretiklar', 'Тиазидные диуретики', '{}', '{gidroxlorotiazid,hydrochlorothiazide,гидрохлортиазид,indapamid,indapamide,индапамид}', 56),
  ('corticosteroids', 'Glyukokortikoidlar', 'Глюкокортикоиды', '{}', '{prednizolon,prednisolone,преднизолон,deksametazon,dexamethasone,дексаметазон,gidrokortizon,гидрокортизон}', 57);

CREATE TABLE drugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inn text NOT NULL,                       -- international non-proprietary name (Latin/English INN), never a brand
  inn_ru text NOT NULL,                    -- Russian МНН as written in pharmacies of Uzbekistan
  atc text CHECK (atc IS NULL OR atc ~ '^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$'),
  forms text[] NOT NULL DEFAULT '{}',      -- dosage-form codes (tab, caps, inj …); labels live in the i18n catalog
  allergy_classes text[] NOT NULL DEFAULT '{}',
  prescription_only boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'starter' CHECK (source IN ('starter', 'official')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX drugs_inn_key ON drugs (lower(inn));
CREATE INDEX drugs_search_trgm ON drugs USING gin ((lower(inn || ' ' || inn_ru)) gin_trgm_ops);

CREATE TABLE patient_allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid NOT NULL,
  class_code text REFERENCES allergy_classes(code),
  drug_id uuid REFERENCES drugs(id),
  free_text text CHECK (free_text IS NULL OR length(free_text) BETWEEN 2 AND 300),
  reaction text CHECK (reaction IS NULL OR length(reaction) <= 300),
  severity text NOT NULL DEFAULT 'unknown' CHECK (severity IN ('mild', 'moderate', 'severe', 'unknown')),
  -- manual: entered by the doctor; intake: what the patient said (to reception, or in the Telegram intake)
  source text NOT NULL CHECK (source IN ('manual', 'intake')),
  recorded_by uuid,
  recorded_by_name text NOT NULL,
  recorded_by_role text NOT NULL CHECK (recorded_by_role IN ('doctor', 'registrar')),
  recorded_at timestamptz NOT NULL DEFAULT demo_now(),
  -- a patient-reported allergy recorded by reception is confirmed by a doctor (once); a doctor's own entry is confirmed at once
  confirmed_at timestamptz,
  confirmed_by_name text,
  withdrawn_at timestamptz,
  withdrawn_by_name text,
  withdraw_reason text,
  CHECK (class_code IS NOT NULL OR drug_id IS NOT NULL OR free_text IS NOT NULL),
  CHECK (withdrawn_at IS NULL OR (withdrawn_by_name IS NOT NULL AND withdraw_reason IS NOT NULL)),
  -- reception records the patient's words only: never a class or a drug
  CHECK (recorded_by_role = 'doctor' OR (class_code IS NULL AND drug_id IS NULL AND source = 'intake')),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);
CREATE INDEX patient_allergies_patient ON patient_allergies (tenant_id, patient_id, recorded_at DESC);

-- Append-only evidence: the only changes are confirm (once) and withdraw (once). No deletes.
CREATE FUNCTION patient_allergy_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'patient allergy cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.class_code IS DISTINCT FROM OLD.class_code OR NEW.drug_id IS DISTINCT FROM OLD.drug_id
     OR NEW.free_text IS DISTINCT FROM OLD.free_text OR NEW.reaction IS DISTINCT FROM OLD.reaction
     OR NEW.severity <> OLD.severity OR NEW.source <> OLD.source OR NEW.recorded_at <> OLD.recorded_at
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR NEW.recorded_by_name <> OLD.recorded_by_name OR NEW.recorded_by_role <> OLD.recorded_by_role
     OR OLD.withdrawn_at IS NOT NULL
     OR (OLD.confirmed_at IS NOT NULL AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by_name IS DISTINCT FROM OLD.confirmed_by_name)) THEN
    RAISE EXCEPTION 'patient allergy is append-only (confirm or withdraw once)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patient_allergies_append_only BEFORE UPDATE OR DELETE ON patient_allergies
  FOR EACH ROW EXECUTE FUNCTION patient_allergy_guard();
