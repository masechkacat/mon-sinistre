/*
  Warnings:

  - Made the column `nameNormalized` on table `Commune` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Commune" ALTER COLUMN "nameNormalized" SET NOT NULL;
