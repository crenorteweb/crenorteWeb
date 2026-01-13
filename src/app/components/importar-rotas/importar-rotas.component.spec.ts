import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImportarRotasComponent } from './importar-rotas.component';

describe('ImportarRotasComponent', () => {
  let component: ImportarRotasComponent;
  let fixture: ComponentFixture<ImportarRotasComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportarRotasComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImportarRotasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
