import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CriarGrupoComponent } from './criar-grupo.component';

describe('CriarGrupoComponent', () => {
  let component: CriarGrupoComponent;
  let fixture: ComponentFixture<CriarGrupoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CriarGrupoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CriarGrupoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
