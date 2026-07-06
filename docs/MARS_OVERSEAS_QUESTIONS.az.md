# Mars Overseas — Trade Budget sistemi üçün dəqiqləşdirmə sualları

*Hazırlanma: 2026-07-06. Göndərən: Rashad. Bu cavablar sistemin 3 modulunu açır:
büdcə hesablanması, xərc uçotu və gündəlik data axını.*

Hörmətli həmkarlar,

Trade Marketing büdcə monitorinqi sisteminin ilk hissəsi hazırdır (kampaniya
kartları, təsdiq axını, master-data importu). Növbəti modulları sizin real
proseslərinizə uyğun qurmaq üçün aşağıdakı məlumatlara ehtiyacımız var.

## A. Trade xərclərinin növləri

1. İstifadə etdiyiniz bütün trade xərc növlərini sadalayın. Bizim ilkin
   siyahımız (təsdiqləyin / düzəldin / əlavə edin):
   - Faktura endirimi (invoice-üstü)
   - Retro bonus
   - Listing haqqı (şəbəkələrə giriş/rəf haqqı)
   - Promo ödənişi (aksiya kompensasiyaları)
   - Pulsuz mal
   - POSM / merchandising xərcləri
2. Hər növ üçün: bu xərc **harada qeyd olunur** (Mikro? ayrıca cədvəl? müqavilə?)
   və məbləğ **nə vaxt dəqiq məlum olur** (faktura anında? ay sonunda hesablama
   ilə? ödəniş anında?)
3. Retro bonusların hesablanma qaydası nədir? (aylıq/rüblük hədəf faizi,
   pilləli şkala, müştəri qrupuna görə fərq və s.)

## B. Büdcə qaydası

4. Trade büdcə satış planının faizi kimi müəyyənləşirmi? Faiz kanal /
   kateqoriya / brend üzrə fərqlidirmi — konkret rəqəmlərlə?
5. PepsiCo (principal) trade fondlarının bir hissəsini maliyyələşdirirmi?
   Əgər hə — principal fondu ilə öz büdcənizi ayrı izləmək lazımdırmı?
6. Ay ortasında büdcə dəyişikliyini kim təsdiq edir?

## C. Nümunə fayllar (sistemin qurulması üçün)

Aşağıdakıları olduğu kimi, təmizləmədən göndərin (formatın özü bizə lazımdır):

7. **Bir günlük satış/faktura exportu** Mikro-dan (sətir səviyyəsində)
8. **Bir aylıq trade-xərc qeydləri** (hansı formatda saxlayırsınızsa)
9. **Satış planının nümunəsi** (kanal/brend bölgüsü ilə)
10. **Müştəri (outlet) və məhsul (SKU) master siyahıları**

## D. Gündəlik data axını — təklif etdiyimiz qayda (təsdiqinizi xahiş edirik)

- Hər iş günü üçün **bir fayl** (`satis_2026-07-06.xlsx` kimi), içində həmin
  günün **bütün** fakturaları; düzəliş lazımdırsa həmin günün faylı bütöv
  yenidən göndərilir (sistem köhnəsini avtomatik əvəz edir, heç nə itmir).
- Çatdırılma vaxtı: D gününün faylı **D+1 saat 09:00-a qədər**.
- Qaytarma/kredit-nota — mənfi məbləğli sətir, orijinal faktura nömrəsi ilə.
- Fayl gecikəndə sistem «məlumat bu tarixə qədərdir» göstərəcək — saxta rəqəm
  göstərməyəcək.
- Suallar: faylı kim göndərəcək? Hansı kanalla (email/paylaşılan qovluq)?
  Faktura tarixi ilə çatdırılma tarixi fərqlənirsə, hansı əsas sayılır?

## E. Texniki

11. Mikro-dan 1C-yə keçid hansı mərhələdədir və təqribi tarix varmı?
    (Mümkünsə, keçiddə müştəri/məhsul kodlarının saxlanmasını xahiş edirik —
    bu, sistemin fasiləsiz işləməsini təmin edir.)
12. Satış planı yalnız aylıqdır, yoxsa günlük/marşrut səviyyəsində plan da
    mövcuddur (SFA sistemində)?

Təşəkkürlər! A və B bloklarının cavabları + C faylları gələn kimi növbəti
modulları (büdcə hesablanması və gündəlik izləmə) işə salırıq.
