import unified from 'unified';
import u from 'unist-builder';
import remarkEscapeMarkdownEntities from '../remarkEscapeMarkdownEntities';

const process = text => {
  const tree = u('root', [ u('text', text) ]);
  const escapedMdast = unified()
    .use(remarkEscapeMarkdownEntities)
    .runSync(tree);

  return escapedMdast.children[0].value;
};

describe('remarkEscapeMarkdownEntities', () => {
  it('should escape common markdown entities', () => {
    expect(process('*a*')).toEqual('\\*a\\*');
    expect(process('**a**')).toEqual('\\*\\*a\\*\\*');
    expect(process('***a***')).toEqual('\\*\\*\\*a\\*\\*\\*');
    expect(process('_a_')).toEqual('\\_a\\_');
    expect(process('__a__')).toEqual('\\_\\_a\\_\\_');
    expect(process('~~a~~')).toEqual('\\~\\~a\\~\\~');
  });

  it('should not escape inactive markdown entities', () => {
    expect(process('a*b')).toEqual('a*b');
    expect(process('a ** b')).toEqual('a ** b');
    expect(process('_')).toEqual('_');
    expect(process('a __ b')).toEqual('a __ b');
    expect(process('~')).toEqual('~');
    expect(process('~~')).toEqual('~~');
    expect(process('a ~~ b')).toEqual('a ~~ b');
  });

  it('should escape leading markdown entities', () => {
    expect(process('#')).toEqual('\\#');
    expect(process('-')).toEqual('\\-');
    expect(process('*')).toEqual('\\*');
  });

  it('should escape leading markdown entities preceded by whitespace', () => {
    expect(process('\n #')).toEqual('\\#');
    expect(process(' \n-')).toEqual('\\-');
  });

  it('should not escape leading markdown entities preceded by non-whitespace characters', () => {
    expect(process('a# # b #')).toEqual('a# # b #');
    expect(process('a- - b -')).toEqual('a- - b -');
  });

  it('should not escape the contents of preformatted html blocks', () => {
    expect(process('<pre>*a*</pre>')).toEqual('<pre>*a*</pre>');
  });
});
