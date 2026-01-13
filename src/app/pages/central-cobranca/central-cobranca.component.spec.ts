import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CentralCobrancaComponent } from './central-cobranca.component';

describe('CentralCobrancaComponent', () => {
  let component: CentralCobrancaComponent;
  let fixture: ComponentFixture<CentralCobrancaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CentralCobrancaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CentralCobrancaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
