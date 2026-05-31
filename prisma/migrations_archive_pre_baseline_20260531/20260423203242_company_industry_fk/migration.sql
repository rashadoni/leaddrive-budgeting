-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_industry_fkey" FOREIGN KEY ("industry") REFERENCES "industries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
