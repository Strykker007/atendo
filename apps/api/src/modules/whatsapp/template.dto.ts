import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Template escolhido na tela: nome + idioma (como a Cloud API identifica) e os valores das
 * variáveis. Os valores aceitam `{{contact.first_name}}` e afins — quem resolve é o service,
 * depois de conferir o template na Meta (`NumbersService.template`).
 */
export class TemplateChoiceDto {
  @IsString() @MaxLength(512) name: string;
  @IsString() @MaxLength(15) language: string;
  /** valores por variável (`{ "1": "Ana" }`) */
  @IsOptional() @IsObject() header?: Record<string, string>;
  @IsOptional() @IsObject() body?: Record<string, string>;
}
