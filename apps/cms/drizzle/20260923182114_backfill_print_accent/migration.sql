-- Custom SQL migration file, put your code below! --
-- The colours documents carry so far are the print's own (the legacy import and the
-- template seed read them from the PDFs); nothing has changed one yet.
UPDATE `documents` SET `print_accent` = `accent` WHERE `print_accent` IS NULL;
