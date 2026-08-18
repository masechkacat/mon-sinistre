import { parseXml, XmlElement } from '@rgrove/parse-xml';
import { textWithLineBreaks } from './xml-tree';

const cell = (inner: string): XmlElement =>
  parseXml(`<td>${inner}</td>`).root as XmlElement;

describe('textWithLineBreaks', () => {
  it('turns each <br/> into a line break', () => {
    expect(textWithLineBreaks(cell('Date de début<br/>de l’événement'))).toBe(
      'Date de début\nde l’événement',
    );
  });

  it('keeps the line breaks of a <br/> nested inside another element', () => {
    expect(
      textWithLineBreaks(cell('<p>Le critère<br/>est satisfait</p>')),
    ).toBe('Le critère\nest satisfait');
  });

  it('drops the blank lines left by the source file’s indentation', () => {
    expect(textWithLineBreaks(cell('\n  <br/>\n  Aisne\n  <br/>\n  '))).toBe(
      'Aisne',
    );
  });
});
