import { jorfFixture } from 'test/fixtures/jorf';
import { selectCatnatTextIds } from './select-catnat-texts';

const tocXml = jorfFixture('JORFCONT000054245240.xml');

describe('selectCatnatTextIds', () => {
  it('selects the catastrophe-naturelle arrêté from the issue table of contents', () => {
    expect(selectCatnatTextIds(tocXml)).toEqual(['JORFTEXT000054245373']);
  });

  it('does not select an unrelated arrêté of the same issue', () => {
    expect(selectCatnatTextIds(tocXml)).not.toContain('JORFTEXT000054246001');
  });

  it('matches regardless of the title wording case', () => {
    const toc = `<JO><STRUCTURE_TXT><LIEN_TXT idtxt="X" titretxt="ARRÊTÉ PORTANT RECONNAISSANCE DE L'ÉTAT DE CATASTROPHE NATURELLE"/></STRUCTURE_TXT></JO>`;
    expect(selectCatnatTextIds(toc)).toEqual(['X']);
  });

  it('returns an empty list when the table of contents has no matching text', () => {
    const toc = `<JO><STRUCTURE_TXT><LIEN_TXT idtxt="X" titretxt="Décret portant nomination"/></STRUCTURE_TXT></JO>`;
    expect(selectCatnatTextIds(toc)).toEqual([]);
  });
});
