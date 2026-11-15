import assert from "node:assert/strict";
import { test } from "node:test";
import { slugPattern } from "../src/modules/seo/paths";
import type { VehicleModel } from "../src/modules/store/vehicle-catalog";
import { compareSlugSnapshots, slugSnapshot } from "../src/modules/store/vehicle-model-slug-snapshot";
import { vehicleModelGroupFamilies, vehicleModelGroupYears, vehicleModelGroups } from "../src/modules/store/vehicle-model-groups";

// Model page units and their addresses (#639). The catalog rows below are copied from the local vehicle_models
// (2026-11-15): a renamed or regrouped series would change a public address, so the slugs are pinned here.
type Row = [id: number, name: string, dateFrom: string | null, dateTo: string | null];
const catalog: Record<string, Row[]> = {
  "AUDI": [
    [253,"A4 B5 (8D2)","1994-11","2001-12"],
    [3485,"A4 B5 Avant (8D5)","1994-11","2002-12"],
    [4731,"A4 B6 (8E2)","2000-11","2005-12"],
    [4797,"A4 B6 Avant (8E5)","2000-02","2005-12"],
    [4840,"A4 B6 Convertible (8H7)","2002-01","2009-12"],
    [5376,"A4 B7 (8EC)","2004-11","2009-01"],
    [5377,"A4 B7 Avant (8ED)","2004-11","2008-11"],
    [6418,"A4 B8 (8K2)","2007-08","2017-06"],
    [6988,"A4 B8 Avant (8K5)","2007-11","2017-06"],
    [8031,"A4 Allroad B8 (8KH)","2009-04","2017-06"],
    [14695,"A4 B9 (8W2, 8WC)","2015-05",null],
    [14696,"A4 B9 Avant (8W5, 8WD)","2015-08",null],
    [36378,"A4 Allroad B9 (8WH, 8WJ)","2016-01",null],
    [41689,"A4 B7 Convertible (8HE)","2002-01","2010-01"],
  ],
  "BEDFORD": [
    [1070,"MIDI Bus","1984-09","1992-08"],
    [3568,"MIDI Van","1984-08","1992-08"],
  ],
  "BMW": [
    [286,"3 (E21)","1975-06","1984-03"],
    [290,"3 (E30)","1982-09","1992-03"],
    [294,"3 Touring (E30)","1987-07","1994-10"],
    [299,"3 Compact (E36)","1994-01","2000-08"],
    [304,"3 (E36)","1990-09","1998-11"],
    [308,"3 Coupe (E36)","1991-10","1999-05"],
    [430,"3 Convertible (E30)","1982-09","1993-11"],
    [434,"3 Convertible (E36)","1993-03","1999-11"],
    [1311,"3 Touring (E36)","1994-08","1999-12"],
    [3397,"3 (E46)","1997-12","2005-05"],
    [3999,"3 Coupe (E46)","1998-12","2006-07"],
    [4088,"3 Touring (E46)","1999-06","2005-07"],
    [4571,"3 Convertible (E46)","2000-04","2007-12"],
    [4751,"3 Compact (E46)","2001-03","2005-02"],
    [5389,"3 (E90)","2004-02","2012-02"],
    [5430,"3 Touring (E91)","2004-12","2012-12"],
    [5569,"3 Coupe (E92)","2005-01","2013-12"],
    [6241,"3 Convertible (E93)","2006-05","2013-12"],
    [9831,"3 (F30, F80)","2011-11","2018-10"],
    [10266,"3 Touring (F31)","2012-07","2019-06"],
    [11207,"3 Gran Turismo (F34)","2012-07",null],
    [39027,"3 (G20, G80, G28)","2018-11",null],
    [39625,"3 Touring (G21, G81)","2019-07",null],
    [39643,"3 Touring Van (F31)","2012-07","2019-06"],
    [40436,"3 Touring Van (G21)","2019-07",null],
  ],
  "FIAT": [
    [404,"TIPO (160_)","1987-07","1997-10"],
    [4728,"DOBLO MPV (119_, 223_)","2001-03",null],
    [4743,"DOBLO Box Body/MPV (223_)","2000-11",null],
    [6409,"LINEA (323_, 110_)","2006-10",null],
    [8617,"DOBLO Bus (263_)","2009-11","2023-12"],
    [8618,"DOBLO Cargo (263_)","2010-02",null],
    [9205,"DOBLO Platform/Chassis (263_)","2010-02","2023-12"],
    [14915,"TIPO Saloon (356_, 357_)","2015-10",null],
    [36526,"TIPO Hatchback (356_, 357_)","2016-03",null],
    [36527,"TIPO Estate (356_, 357_)","2016-03",null],
    [43543,"DOBLO MPV (510_, 511_, 360_, 361_)","2022-06",null],
    [43544,"DOBLO Box Body/MPV (510_, 511_)","2022-06",null],
  ],
  "FORD": [
    [3588,"FOCUS I (DAW, DBW)","1998-09","2009-11"],
    [3589,"FOCUS I Turnier (DNW)","1999-02","2007-12"],
    [3590,"FOCUS I Saloon (DFW)","1999-02","2009-11"],
    [5056,"FOCUS C-MAX (DM2)","2003-10","2007-03"],
    [5210,"FOCUS II (DA_, HCP, DP)","2004-07","2013-09"],
    [5397,"FOCUS II Turnier (DA_, FFS, DS)","2004-07","2012-09"],
    [5454,"FOCUS II Saloon (DB_, FCH, DH)","2005-04",null],
    [5561,"FOCUS II Convertible","2006-10","2010-09"],
    [9155,"FOCUS III","2010-07","2020-02"],
    [9156,"FOCUS III Saloon","2010-07","2020-02"],
    [9157,"FOCUS III Turnier","2010-07","2020-02"],
    [36894,"FOCUS III Estate Van","2012-02","2020-02"],
    [36895,"FOCUS III Hatchback Van","2011-01","2020-02"],
    [38611,"FOCUS IV (HN)","2018-01",null],
    [38774,"FOCUS IV Turnier (HP)","2018-09",null],
    [38849,"FOCUS I Estate Van (DNW)","1998-08","2005-03"],
    [39142,"FOCUS IV Saloon (HM)","2018-11",null],
    [39233,"FOCUS II Estate Van","2004-07","2011-07"],
  ],
  "MERCEDES-BENZ": [
    [520,"C-CLASS (W202)","1993-03","2000-05"],
    [1516,"C-CLASS T-Model (S202)","1996-06","2001-03"],
    [4640,"C-CLASS (W203)","2000-05","2007-12"],
    [4708,"C-CLASS Coupe (CL203)","2001-03","2011-06"],
    [4754,"C-CLASS T-Model (S203)","2001-03","2007-08"],
    [6224,"C-CLASS (W204)","2007-01","2015-01"],
    [6437,"C-CLASS T-Model (S204)","2007-08","2014-08"],
    [9624,"C-CLASS Coupe (C204)","2011-01",null],
    [11851,"C-CLASS (W205)","2013-07","2023-02"],
    [12855,"C-CLASS T-Model (S205)","2014-09","2023-02"],
    [14664,"C-CLASS Coupe (C205)","2015-10","2023-04"],
    [36610,"C-CLASS Convertible (A205)","2016-06","2023-04"],
    [41824,"C-CLASS (W206)","2021-03",null],
    [41835,"C-CLASS T-MODEL (S206)","2021-03",null],
    [42667,"C-CLASS All-Terrain (S206)","2021-12",null],
  ],
  "OPEL": [
    [376,"ASTRA F Saloon (T92)","1991-09","2001-01"],
    [380,"ASTRA F Convertible (T92)","1993-03","2001-03"],
    [388,"ASTRA F Hatchback (T92)","1991-09","2000-10"],
    [3405,"ASTRA G Hatchback (T98)","1998-02","2009-12"],
    [3406,"ASTRA G Estate (T98)","1998-02","2005-07"],
    [3440,"ASTRA F Estate (T92)","1991-09","2001-01"],
    [3878,"ASTRA G Saloon (T98)","1998-03","2009-12"],
    [4017,"ASTRA F Estate Van (T92)","1991-10","1999-01"],
    [4203,"ASTRA G Coupe (T98)","2000-03","2006-06"],
    [4583,"ASTRA G Estate Van (F70)","1998-09","2005-04"],
    [4702,"ASTRA F CLASSIC Saloon (T92)","1998-01","2002-08"],
    [4703,"ASTRA F CLASSIC Hatchback (T92)","1998-01","2002-08"],
    [4704,"ASTRA F CLASSIC Estate (T92)","1998-01","2005-01"],
    [4760,"ASTRA G Convertible (T98)","2001-03","2005-10"],
    [5098,"ASTRA H (A04)","2004-01","2014-05"],
    [5145,"ASTRA H Estate (A04)","2004-08","2014-05"],
    [5209,"ASTRA H GTC (A04)","2005-03","2010-10"],
    [5453,"ASTRA H TwinTop (A04)","2005-09","2010-10"],
    [7918,"ASTRA H Saloon (A04)","2007-02","2014-05"],
    [8261,"ASTRA J (P10)","2009-09","2016-04"],
    [9017,"ASTRA J Sports Tourer (P10)","2010-10","2015-10"],
    [9183,"ASTRA H Estate Van (L70)","2004-02","2014-10"],
    [9628,"ASTRA J GTC","2011-10","2018-04"],
    [10351,"ASTRA J Saloon","2012-06",null],
    [14508,"ASTRA K (B16)","2015-06","2021-09"],
    [14870,"ASTRA K Sports Tourer (B16)","2015-11","2021-12"],
    [37067,"ASTRA H CLASSIC Hatchback (A04)","2009-01",null],
    [37099,"ASTRA H CLASSIC Saloon (A04)","2007-02",null],
    [37112,"ASTRA H CLASSIC Estate (A04)","2006-12",null],
    [38278,"ASTRA G CLASSIC (T98)","2004-03","2009-07"],
    [38279,"ASTRA G CLASSIC Saloon (T98)","2004-03","2009-07"],
    [38280,"ASTRA G CLASSIC Caravan (F35)","2004-03","2009-07"],
    [38919,"ASTRA J Hatchback Van (P10)","2009-09","2015-10"],
    [38920,"ASTRA J Estate Van (P10)","2009-09","2015-10"],
    [40158,"ASTRA K Hatchback Van","2015-06","2021-12"],
    [41091,"ASTRA K Estate Van","2015-11","2021-09"],
    [42533,"ASTRA L (OV5)","2021-10",null],
    [42642,"ASTRA L Sports Tourer (OV5)","2021-10",null],
  ],
  "RENAULT": [
    [21,"CLIO I (B/C57_, 5/357_)","1990-05","1999-08"],
    [1479,"MEGANE I (BA0/1_)","1995-08","2004-12"],
    [1488,"MEGANE I Coach (DA0/1_)","1996-03","2003-08"],
    [1561,"MEGANE I Classic (LA0/1_)","1996-09","2008-08"],
    [1562,"MEGANE Scénic (JA0/1_)","1996-10","2001-12"],
    [1902,"MEGANE I Cabriolet (EA0/1_)","1996-10","2003-08"],
    [3508,"CLIO II (BB_, CB_)","1998-03","2016-12"],
    [4084,"MEGANE I Grandtour (KA0/1_)","1999-03","2003-08"],
    [4218,"CLIO I Hatchback Van (S57_)","1991-01","1998-09"],
    [4790,"CLIO II Hatchback Van (SB0/1/2_)","1998-09",null],
    [4940,"MEGANE II (BM0/1_, CM0/1_)","2001-07","2012-10"],
    [5071,"MEGANE II Coupé-Cabriolet (EM0/1_)","2003-09","2010-03"],
    [5072,"MEGANE II Saloon (LM0/1_)","2003-08",null],
    [5073,"MEGANE II Estate (KM0/1_)","2003-08","2012-08"],
    [5462,"CLIO III (BR0/1, CR0/1)","2005-01","2014-12"],
    [6446,"CLIO III Grandtour (KR0/1_)","2007-11","2014-12"],
    [7866,"MEGANE III Hatchback (BZ0/1_, B3_)","2008-11",null],
    [7867,"MEGANE III Coupe (DZ0/1_)","2008-11","2016-09"],
    [8145,"MEGANE III Grandtour (KZ0/1)","2008-11","2016-01"],
    [8578,"MEGANE CC (EZ0/1_)","2010-06","2015-08"],
    [10852,"CLIO IV (BH_)","2012-11","2021-08"],
    [10870,"CLIO IV Sport Tourer (KH_)","2012-11","2021-08"],
    [11387,"CLIO III Hatchback Van (SB_, SR_)","2005-06",null],
    [14908,"MEGANE IV Hatchback (B9A/M/N_)","2015-11",null],
    [36675,"MEGANE IV Sport Tourer (K9A/M/N_)","2016-04",null],
    [37429,"CLIO IV Hatchback Van (BH_)","2014-01","2021-08"],
    [38201,"MEGANE IV Grand Coupe (LVA/M/N)","2016-10",null],
    [38244,"MEGANE II Estate Van (KM_)","2003-08","2009-07"],
    [38410,"MEGANE II Hatchback Van (KM0/2_)","2003-08","2009-07"],
    [38856,"MEGANE I Hatchback Van (SA0/1_)","1995-08","2003-07"],
    [39140,"MEGANE III Combi Van (KZ0/1)","2009-01","2015-08"],
    [39267,"MEGANE III Hatchback Van (BZ_)","2008-11","2015-08"],
    [40028,"CLIO V (B7_)","2019-06",null],
    [41293,"CLIO IV Estate Van (KH_)","2013-01","2021-08"],
    [41723,"MEGANE Scénic VAN (JA0/1_)","1996-10","2001-12"],
    [42636,"MEGANE E-TECH SUV","2021-11",null],
    [47047,"CLIO","2025-10",null],
  ],
  "TOYOTA": [
    [98,"COROLLA Compact (_E10_)","1992-05","1999-12"],
    [108,"COROLLA (_E8_)","1983-06","1989-06"],
    [114,"COROLLA (_E9_)","1987-05","1999-09"],
    [120,"COROLLA Hatchback (KE, TE)","1972-10","1980-01"],
    [125,"COROLLA Compact (_E9_)","1987-05","1995-10"],
    [130,"COROLLA Coupe (AE86)","1983-05","1987-07"],
    [135,"COROLLA Hatchback (_E7_)","1979-09","1983-09"],
    [140,"COROLLA Liftback (_E8_)","1982-05","1989-05"],
    [146,"COROLLA Liftback (_E10_)","1992-05","1999-12"],
    [151,"COROLLA Liftback (_E9_)","1987-05","1997-04"],
    [156,"COROLLA Station Wagon (_E9_)","1987-05","1995-10"],
    [161,"COROLLA Estate (_E7_)","1979-12","1989-08"],
    [166,"COROLLA (_E7_)","1979-09","1987-09"],
    [170,"COROLLA Estate (_E10_)","1991-09","1998-04"],
    [1446,"COROLLA FX Compact (E8B)","1984-08","1988-05"],
    [1972,"COROLLA (_E11_)","1995-05","2003-02"],
    [1973,"COROLLA Liftback (_E11_)","1997-04","2002-01"],
    [1974,"COROLLA Compact (_E11_)","1997-04","2002-01"],
    [2061,"COROLLA Coupe (KE)","1975-07","1982-12"],
    [2062,"COROLLA Estate (TE72_)","1975-07","1982-07"],
    [2063,"COROLLA (KE_, TE_)","1970-02","1982-11"],
    [3463,"COROLLA (_E10_)","1991-06","1999-11"],
    [3863,"COROLLA Estate (_E11_)","1997-04","2001-10"],
    [4851,"COROLLA (_E12_)","2001-01","2008-04"],
    [4852,"COROLLA Saloon (_E12_)","2000-08","2008-12"],
    [4853,"COROLLA Estate (_E12_)","2001-03","2008-12"],
    [4854,"COROLLA Verso (_E12_)","2001-07","2007-05"],
    [5127,"COROLLA Verso (ZER_, ZZE12_, R1_)","2004-03","2009-10"],
    [7967,"COROLLA Saloon (_E15_)","2006-10","2018-12"],
    [11560,"COROLLA Saloon (_E18_, ZRE1_)","2013-06","2021-02"],
    [13581,"COROLLA Coupe (_E9_)","1987-05","1995-10"],
    [38826,"COROLLA Coupe (_E7_)","1979-08","1983-07"],
    [39041,"COROLLA Estate Van (_E11_)","2000-09","2001-10"],
    [39165,"COROLLA Hatchback (_E21_, _EA1_, _EH1_)","2018-10",null],
    [39436,"COROLLA Saloon (_E21_)","2019-01",null],
    [39452,"COROLLA Estate (_E21_)","2019-02",null],
    [40962,"COROLLA CROSS (ZVG1_, ZSG1_, MXGH1_, MXGA1_)","2020-07",null],
  ],
  "VOLKSWAGEN": [
    [403,"PASSAT B1 (32)","1973-05","1981-07"],
    [408,"PASSAT B2 (32B)","1979-09","1989-07"],
    [412,"PASSAT B3/B4 (3A2, 35I)","1988-02","1997-12"],
    [415,"PASSAT B1 Variant (33)","1973-05","1981-10"],
    [419,"PASSAT B2 Variant (33B)","1980-08","1989-06"],
    [423,"PASSAT B3/B4 Variant (3A5, 35I)","1988-02","1997-06"],
    [455,"TRANSPORTER T2 Bus (22, 23, 24)","1967-08","1979-09"],
    [463,"TRANSPORTER T4 Bus (70B, 70C, 7DB, 7DK, 70J, 70K, 7DC, 7DJ)","1990-09","2004-10"],
    [488,"GOLF I Cabriolet (155)","1979-01","1993-08"],
    [493,"GOLF III Cabriolet (1E7)","1993-07","1998-05"],
    [497,"GOLF I (17)","1974-04","1985-12"],
    [500,"GOLF II (19E, 1G1)","1983-08","1992-12"],
    [505,"GOLF III (1H1)","1989-10","2000-11"],
    [510,"GOLF III Variant (1H5)","1993-07","1999-04"],
    [1447,"PASSAT B2 Saloon (32B)","1982-05","1989-06"],
    [1568,"PASSAT B5 (3B2)","1996-08","2001-12"],
    [1598,"TRANSPORTER T1 Bus (22, 24, 25, 28)","1950-01","1968-12"],
    [1626,"TRANSPORTER T1 Van (21, 23)","1950-01","1968-12"],
    [1627,"TRANSPORTER T1 Platform/Chassis (26)","1950-01","1970-10"],
    [1628,"TRANSPORTER T2 Van (21, 23)","1968-08","1979-07"],
    [1629,"TRANSPORTER T3 Van (24_, 25_)","1979-05","1992-12"],
    [1630,"TRANSPORTER T3 Platform/Chassis (24_)","1979-05","1992-12"],
    [1631,"TRANSPORTER T4 Van (70A, 70H, 7DA, 7DH, 70J)","1990-07","2003-04"],
    [1632,"TRANSPORTER T4 Platform/Chassis (70E, 70L, 70M, 7DE, 7DL, 7D","1990-07","2003-04"],
    [1907,"PASSAT B5 Variant (3B5)","1997-05","2001-12"],
    [1994,"GOLF IV (1J1)","1997-08","2008-04"],
    [1995,"GOLF IV Variant (1J5)","1999-05","2006-06"],
    [1996,"GOLF IV Cabriolet (1E7)","1998-06","2002-12"],
    [3888,"TRANSPORTER T2 Platform/Chassis (21, 26)","1968-08","1979-07"],
    [3889,"TRANSPORTER T3 Bus (25_)","1979-05","2003-12"],
    [4736,"PASSAT B5.5 (3B3)","2000-10","2005-12"],
    [4737,"PASSAT B5.5 Variant (3B6)","2000-09","2005-08"],
    [4991,"GOLF V (1K1)","2003-10","2010-07"],
    [5003,"TRANSPORTER T5 Platform/Chassis (7JD, 7JE, 7JL, 7JY, 7JZ, 7F","2003-04","2016-03"],
    [5004,"TRANSPORTER T5 Van (7HA, 7HH, 7EA, 7EH)","2003-04",null],
    [5005,"TRANSPORTER T5 Bus (7HB, 7HJ, 7EB, 7EJ)","2003-04","2016-03"],
    [5379,"GOLF PLUS V (5M1, 521)","2004-12","2013-12"],
    [5398,"PASSAT B6 (3C2)","2005-03","2011-04"],
    [5427,"PASSAT B6 Variant (3C5)","2005-08","2011-11"],
    [6245,"GOLF V Variant (1K5)","2007-01","2009-07"],
    [7375,"PASSAT CC B6 (357)","2008-02","2012-06"],
    [7873,"GOLF VI (5K1)","2008-10","2014-12"],
    [8442,"GOLF VI Variant (AJ5)","2009-07","2014-07"],
    [9003,"PASSAT B7 (362)","2010-08","2016-04"],
    [9004,"PASSAT B7 Variant (365)","2010-08","2015-12"],
    [9158,"GOLF VI Convertible (517)","2011-03","2017-10"],
    [10585,"GOLF VII (5G1, BQ1, BE1, BE2)","2012-08","2021-10"],
    [11084,"PASSAT ALLTRACK B7 Variant (365)","2012-01","2014-12"],
    [11165,"PASSAT B7 (A32, A33)","2011-01","2020-12"],
    [11221,"GOLF VII Variant (BA5, BV5)","2013-04","2022-01"],
    [11878,"GOLF SPORTSVAN VII (AM1, AN1)","2014-02","2020-08"],
    [12917,"PASSAT B8 (3G2, CB2)","2014-08",null],
    [12918,"PASSAT B8 Variant (3G5, CB5)","2014-08",null],
    [13608,"GOLF ALLTRACK VII Variant (BA5, BV5)","2014-12","2020-12"],
    [14350,"TRANSPORTER T6 / CARAVELLE T6 Bus (SGB, SGJ, SHB, SHJ)","2015-04","2024-08"],
    [14351,"TRANSPORTER T6 Van (SGA, SGH, SHA, SHH)","2015-04","2024-08"],
    [14352,"TRANSPORTER T6 Platform/Chassis (SFD, SFE, SFL, SFZ, SJD, SJ","2015-04","2024-08"],
    [14622,"PASSAT ALLTRACK B8 Variant (3G5, CB5)","2015-05",null],
    [37151,"GOLF II Van (19E, 1G1)","1983-08","1991-07"],
    [37153,"GOLF III Van (1H1)","1991-08","1997-12"],
    [37154,"GOLF IV Van (1J1)","1997-10","2004-05"],
    [39030,"PASSAT B7 Estate Van (365)","2010-08","2014-12"],
    [39045,"GOLF VAN IV Variant (1J5)","1999-05","2006-06"],
    [39065,"GOLF VI Van (5K1)","2008-10","2012-11"],
    [39067,"GOLF VAN VI Variant (AJ5)","2009-07","2014-05"],
    [39077,"GOLF VII Van (5G1)","2012-08","2017-03"],
    [39689,"GOLF Van III Variant (1H5)","1991-08","1999-12"],
    [39690,"PASSAT B3/B4 (315, 3A5)","1988-08","1996-12"],
    [40179,"GOLF VIII (CD1, DA1)","2019-07",null],
    [41185,"GOLF VIII Variant (CG5, DB5)","2020-08",null],
    [41767,"GOLF ALLTRACK VIII (CG5)","2020-11",null],
    [45017,"PASSAT B9 Variant (CJ5)","2023-10",null],
    [90131,"TRANSPORTER T7 / CARAVELLE T7 Bus (TV_, TW_)","2024-07",null],
    [90132,"TRANSPORTER T7 Van (TV_, TW_)","2024-07",null],
    [90137,"TRANSPORTER T7 Platform/Chassis (TX_, TY_)","2024-07",null],
  ],
  "CHERY": [
    [38252,"TIGGO 5x","2017-09",null],
    [44517,"TIGGO 9","2023-05",null],
    [46437,"TIGGO 7","2024-11",null],
    [46440,"TIGGO 8 PLUS","2024-09",null],
  ],
  "BYD": [
    [42702,"ATTO 3","2022-02",null],
    [43107,"SEAL","2022-07",null],
    [45173,"SEAL U","2024-02",null],
    [45331,"ATTO 2","2024-03",null],
    [45520,"SEALION 7","2024-05",null],
    [45615,"SEAL 06 Saloon","2024-05",null],
    [46803,"SEAL 6 DM-i Estate","2025-07",null],
    [46852,"SEAL 5","2025-06",null],
  ],
  "MG": [
    [5385,"MG X-POWER","2003-01","2008-04"],
    [9740,"MG 6 Saloon","2010-11",null],
    [42217,"MG 5 Estate","2020-10",null],
    [43566,"MG 4 (EH32)","2022-07",null],
    [45344,"MG 3 (ZP2_)","2024-02",null],
  ],
  "FORD USA": [
    [1916,"MUSTANG Coupe (C)","1993-09","2004-12"],
    [1917,"MUSTANG Convertible (C)","1993-09","2004-12"],
    [5633,"MUSTANG Coupe","2004-12",null],
    [5634,"MUSTANG Convertible","2005-09",null],
    [10945,"MUSTANG Convertible","1978-11","1993-12"],
    [11356,"MUSTANG Coupe","1978-11","1993-12"],
    [13370,"MUSTANG Coupe","2014-02","2023-04"],
    [13371,"MUSTANG Convertible","2014-02",null],
    [36913,"MUSTANG Convertible","1963-09","1973-12"],
    [36914,"MUSTANG Coupe","1963-09","1973-12"],
    [45077,"MUSTANG Coupe","2023-06",null],
    [45078,"MUSTANG Convertible","2023-06",null],
  ],
  "BMW MOTORRAD": [
    [12733,"R 65",null,null],
    [12734,"R 850",null,null],
    [12735,"R 100",null,null],
    [12736,"R 90",null,null],
    [12737,"R 75",null,null],
    [12738,"R 80",null,null],
    [12739,"R 50",null,null],
    [12740,"R 60",null,null],
    [12741,"R 1100",null,null],
    [12742,"R 1150",null,null],
    [12743,"R 1200",null,null],
    [13082,"R 900",null,null],
    [13552,"R 25",null,null],
    [14014,"R",null,null],
    [14480,"R 69",null,null],
    [14697,"R 45",null,null],
    [39516,"R 1250",null,null],
    [40728,"R 18",null,null],
    [45242,"R 1300",null,null],
    [46919,"R 12",null,null],
  ],
};
const pinned: Record<string, string[]> = {
  "AUDI": ["a4-b5", "a4-b6", "a4-b7", "a4-b8", "a4-allroad-b8", "a4-b9", "a4-allroad-b9"],
  "BEDFORD": ["midi-1984"],
  "BMW": ["3-e21", "3-e30", "3-e36", "3-compact-e36", "3-e46", "3-compact-e46", "3-e90", "3-e91", "3-e92", "3-e93", "3-f30", "3-f31", "3-f34", "3-g20", "3-g21"],
  "CHERY": ["tiggo-5x", "tiggo-9", "tiggo-8", "tiggo-7"],
  "BYD": ["atto-3", "seal-2022", "seal-u-2024", "atto-2", "sealion-7", "seal-06", "seal-5", "seal-6"],
  "MG": ["mg-x-power-2003", "mg-6", "mg-5", "mg-eh32", "mg-zp2"],
  "FORD USA": ["mustang-1963", "mustang-1978", "mustang-c", "mustang-2004", "mustang-2014", "mustang-2023"],
  "BMW MOTORRAD": ["r-65", "r-850", "r-100", "r-90", "r-75", "r-80", "r-50", "r-60", "r-1100", "r-1150", "r-1200", "r-900", "r-25", "r-14014", "r-69", "r-45", "r-1250", "r-18", "r-1300", "r-12"],
  "FIAT": ["tipo-160", "doblo-223", "linea-323", "doblo-263", "tipo-356", "doblo-510"],
  "FORD": ["focus-1", "focus-c-max-dm2", "focus-2", "focus-3", "focus-4"],
  "MERCEDES-BENZ": ["c-class-w202", "c-class-s202", "c-class-w203", "c-class-cl203", "c-class-s203", "c-class-w204", "c-class-s204", "c-class-c204", "c-class-w205", "c-class-s205", "c-class-c205", "c-class-a205", "c-class-w206", "c-class-s206"],
  "OPEL": ["astra-f-t92", "astra-f-classic-t92", "astra-g-t98", "astra-g-f70", "astra-h-a04", "astra-h-l70", "astra-g-classic-t98", "astra-g-classic-caravan-f35", "astra-h-gtc-a04", "astra-h-twintop-a04", "astra-h-classic-a04", "astra-j-p10", "astra-j-gtc-2011", "astra-j-2012", "astra-k-b16", "astra-k-2015", "astra-l-ov5"],
  "RENAULT": ["clio-1", "megane-1", "megane-scenic-ja0", "clio-2", "megane-2", "clio-3", "megane-3", "megane-cc-ez0", "clio-4", "megane-4", "clio-5", "megane-e-tech-2021", "clio-2025"],
  "TOYOTA": ["corolla-ke", "corolla-te72", "corolla-e7", "corolla-e8", "corolla-ae86", "corolla-fx-compact-e8b", "corolla-e9", "corolla-compact-e9", "corolla-e10", "corolla-compact-e10", "corolla-e11", "corolla-compact-e11", "corolla-e12", "corolla-verso-e12", "corolla-verso-zer", "corolla-e15", "corolla-e18", "corolla-e21", "corolla-cross-zvg1"],
  "VOLKSWAGEN": ["transporter-t1", "transporter-t2", "passat-b1", "golf-1", "transporter-t3", "passat-b2", "golf-2", "passat-b3-b4", "golf-3", "transporter-t4", "passat-b5", "golf-4", "passat-b5-5", "transporter-t5", "golf-5", "golf-plus-5", "passat-b6", "passat-cc-b6", "golf-6", "passat-b7", "passat-alltrack-b7", "golf-7", "golf-sportsvan-7", "passat-b8", "golf-alltrack-7", "transporter-t6", "passat-alltrack-b8", "golf-8", "golf-alltrack-8", "passat-b9", "transporter-t7"],
};

const models = (rows: Row[]): VehicleModel[] => rows.map(([id, name, dateFrom, dateTo]) => ({ id: String(id), brandId: "1", name, dateFrom, dateTo }));
const groups = (make: string) => vehicleModelGroups(models(catalog[make]));
const members = (make: string, slug: string) => groups(make).find(group => group.slug === slug)?.models.map(model => model.name);

test("catalog series keep their pinned model page addresses", () => {
  for (const [make, slugs] of Object.entries(pinned)) assert.deepEqual(groups(make).map(group => group.slug), slugs, make);
  for (const slug of Object.values(pinned).flat()) assert.match(slug, slugPattern);
});

test("a roman generation joins every body style of the family; sub-families stay apart", () => {
  assert.deepEqual(members("VOLKSWAGEN", "golf-7"), ["GOLF VII (5G1, BQ1, BE1, BE2)", "GOLF VII Van (5G1)", "GOLF VII Variant (BA5, BV5)"]);
  assert.deepEqual(members("VOLKSWAGEN", "golf-sportsvan-7"), ["GOLF SPORTSVAN VII (AM1, AN1)"]);
  assert.deepEqual(members("VOLKSWAGEN", "golf-plus-5"), ["GOLF PLUS V (5M1, 521)"]);
  assert.deepEqual(members("VOLKSWAGEN", "golf-alltrack-7"), ["GOLF ALLTRACK VII Variant (BA5, BV5)"]);
  // "GOLF VAN IV Variant": VAN is a body word, the series is a GOLF IV.
  assert.ok(members("VOLKSWAGEN", "golf-4")?.includes("GOLF VAN IV Variant (1J5)"));
  assert.equal(members("RENAULT", "megane-3")?.length, 5);
  assert.equal(members("FORD", "focus-3")?.length, 5);
  const golf7 = groups("VOLKSWAGEN").find(group => group.slug === "golf-7")!;
  assert.equal(golf7.name, "GOLF 7");
  assert.equal(golf7.family, "GOLF");
  assert.equal(golf7.generation, 7);
});

test("a code word names the unit: passat-b8, a4-b8, transporter-t5, passat-b3-b4, passat-b5-5", () => {
  assert.deepEqual(members("VOLKSWAGEN", "passat-b8"), ["PASSAT B8 (3G2, CB2)", "PASSAT B8 Variant (3G5, CB5)"]);
  assert.deepEqual(members("AUDI", "a4-b8"), ["A4 B8 (8K2)", "A4 B8 Avant (8K5)"]);
  assert.equal(members("VOLKSWAGEN", "transporter-t5")?.length, 3);
  assert.equal(groups("VOLKSWAGEN").find(group => group.slug === "passat-b3-b4")?.name, "PASSAT B3/B4");
  assert.deepEqual(members("VOLKSWAGEN", "passat-b5-5"), ["PASSAT B5.5 Variant (3B6)", "PASSAT B5.5 (3B3)"]);
});

test("series sharing a chassis code are one unit named by the earliest series' first code", () => {
  assert.deepEqual(members("FIAT", "tipo-356"), ["TIPO Saloon (356_, 357_)", "TIPO Hatchback (356_, 357_)", "TIPO Estate (356_, 357_)"]);
  assert.deepEqual(members("FIAT", "tipo-160"), ["TIPO (160_)"]);
  assert.deepEqual(members("FIAT", "doblo-223"), ["DOBLO Box Body/MPV (223_)", "DOBLO MPV (119_, 223_)"]);
  assert.deepEqual(members("BMW", "3-e90"), ["3 (E90)"]);
  assert.deepEqual(members("BMW", "3-e91"), ["3 Touring (E91)"]);
  assert.deepEqual(members("MERCEDES-BENZ", "c-class-w205"), ["C-CLASS (W205)"]);
  assert.equal(groups("FIAT").find(group => group.slug === "tipo-356")?.name, "TIPO (356)");
});

test("code-less series with overlapping years are one unit named by the start year", () => {
  assert.deepEqual(members("BEDFORD", "midi-1984"), ["MIDI Van", "MIDI Bus"]);
  assert.deepEqual(members("RENAULT", "clio-2025"), ["CLIO"]);
  assert.deepEqual(members("RENAULT", "megane-e-tech-2021"), ["MEGANE E-TECH SUV"]);
  const split = vehicleModelGroups(models([[1, "KB", "1972-05", "1980-12"], [2, "KB Van", "1985-01", "1988-12"]]));
  assert.deepEqual(split.map(group => group.slug), ["kb-1972", "kb-1985"]);
});

test("a number right after the family names a code-less model: tiggo-7, atto-3, seal-6, mg-5, r-1200", () => {
  assert.deepEqual(members("CHERY", "tiggo-7"), ["TIGGO 7"]);
  assert.deepEqual(members("CHERY", "tiggo-8"), ["TIGGO 8 PLUS"]);
  assert.deepEqual(members("BYD", "atto-2"), ["ATTO 2"]);
  assert.deepEqual(members("BYD", "seal-6"), ["SEAL 6 DM-i Estate"]);
  // "SEAL" alone and "SEAL U" are other models; "MG 4 (EH32)" is named by its code like any coded series.
  assert.deepEqual(members("BYD", "seal-2022"), ["SEAL"]);
  assert.deepEqual(members("MG", "mg-6"), ["MG 6 Saloon"]);
  assert.deepEqual(members("MG", "mg-5"), ["MG 5 Estate"]);
  assert.deepEqual(members("BMW MOTORRAD", "r-1200"), ["R 1200"]);
  assert.equal(groups("BMW MOTORRAD").length, 20);
  // A roman generation or a code still wins over the number ("LT 28-35 I", "RODEO 6 (ACL_)").
  const rows: Row[] = [[1, "LT 28-35 I Van (281-363)", "1975-01", "1996-12"], [2, "RODEO 6 (ACL_)", "1990-01", "1998-12"], [3, "RODEO 4 (ACL_)", "1990-01", "1998-12"]];
  assert.deepEqual(vehicleModelGroups(models(rows)).map(group => group.slug), ["lt-1", "rodeo-acl"]);
});

test("an open end closes where the family's next generation starts: mustang-2004 stops at the 2014 Mustang", () => {
  assert.deepEqual(members("FORD USA", "mustang-2004"), ["MUSTANG Coupe", "MUSTANG Convertible"]);
  assert.deepEqual(members("FORD USA", "mustang-2014")?.length, 2);
  assert.deepEqual(members("FORD USA", "mustang-2023")?.length, 2);
  // Less than four years later is the same generation (a facelift), as in the description matcher.
  const rows: Row[] = [[1, "KB", "2010-01", null], [2, "KB Van", "2012-06", null]];
  assert.deepEqual(vehicleModelGroups(models(rows)).map(group => group.slug), ["kb-2010"]);
});

test("slug snapshots list the addresses a catalog change loses or changes", () => {
  const make = (rows: Row[]) => [{ id: "1", name: "FORD USA", models: models(rows) }];
  const before = slugSnapshot(make(catalog["FORD USA"].filter(row => row[0] < 13000)));
  const after = slugSnapshot(make(catalog["FORD USA"]));
  const same = compareSlugSnapshots(before, before);
  assert.deepEqual([same.kept, same.added, same.changed.length, same.lost.length], [Object.keys(before.makes["1"].slugs).length, 0, 0, 0]);
  const grown = compareSlugSnapshots(before, after);
  assert.equal(grown.lost.length, 0);
  assert.equal(grown.added, 3);
  assert.deepEqual(grown.changed, []);
  const dropped = compareSlugSnapshots(after, slugSnapshot(make(catalog["FORD USA"].filter(row => row[0] !== 5633))));
  // The unit is named by its earliest series: without the 2004 coupe it moves to the 2005 convertible's year.
  assert.deepEqual(dropped.lost.map(entry => [entry.slug, entry.movedTo]), [["mustang-2004", ["mustang-2005"]]]);
  const lost = compareSlugSnapshots(after, slugSnapshot(make(catalog["FORD USA"].filter(row => row[1] !== "MUSTANG Coupe (C)" && row[1] !== "MUSTANG Convertible (C)"))));
  assert.deepEqual(lost.lost.map(entry => entry.slug), ["mustang-c"]);
  assert.deepEqual(lost.lost[0].movedTo, []);
});

test("a taken slug goes to the earliest unit; a later one adds its lowest model id", () => {
  const rows: Row[] = [[30, "X-TRAIL (T30)", "2001-06", "2013-12"], [12, "X TRAIL Van (T30)", "2003-01", "2007-12"]];
  assert.deepEqual(vehicleModelGroups(models(rows)).map(group => [group.slug, group.models.map(model => model.id)]),
    [["x-trail-t30", ["30"]], ["x-trail-t30-12", ["12"]]]);
  // A series added later does not move an existing address.
  const more = vehicleModelGroups(models([...rows, [99, "X-TRAIL (T30) Pick-up", "2005-01", "2008-12"]]));
  assert.equal(more.find(group => group.models.some(model => model.id === "30"))?.slug, "x-trail-t30");
  assert.equal(more.find(group => group.models.some(model => model.id === "12"))?.slug, "x-trail-t30-12");
});

test("units do not depend on the input order", () => {
  for (const make of Object.keys(catalog)) {
    const key = (list: ReturnType<typeof vehicleModelGroups>) => list.map(group => `${group.slug}:${group.models.map(model => model.id)}`);
    assert.deepEqual(key(vehicleModelGroups(models([...catalog[make]].reverse()))), key(groups(make)), make);
  }
});

test("a unit spans its members' production years; an open end or unknown start stays open", () => {
  const golf7 = groups("VOLKSWAGEN").find(group => group.slug === "golf-7")!;
  assert.deepEqual([golf7.dateFrom, golf7.dateTo], ["2012-08", "2022-01"]);
  const passatB8 = groups("VOLKSWAGEN").find(group => group.slug === "passat-b8")!;
  assert.deepEqual([passatB8.dateFrom, passatB8.dateTo], ["2014-08", null]);
  const unknown = vehicleModelGroups(models([[5, "R 65", null, null]]))[0];
  assert.deepEqual([unknown.slug, unknown.dateFrom, unknown.dateTo], ["r-65", null, null]);
  assert.deepEqual([golf7, passatB8, unknown].map(vehicleModelGroupYears), ["2012–2022", "2014–günümüz", null]);
});

test("families list their generations newest first", () => {
  const families = vehicleModelGroupFamilies(groups("VOLKSWAGEN"));
  assert.deepEqual(families.map(family => family.family).slice(0, 4), ["GOLF", "GOLF ALLTRACK", "GOLF PLUS", "GOLF SPORTSVAN"]);
  assert.deepEqual(families[0].groups.map(group => group.slug), ["golf-8", "golf-7", "golf-6", "golf-5", "golf-4", "golf-3", "golf-2", "golf-1"]);
});
