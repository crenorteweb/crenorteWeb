import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HierarquiaColaboradoresComponent } from './hierarquia-colaboradores.component';

describe('HierarquiaColaboradoresComponent', () => {
  let component: HierarquiaColaboradoresComponent;
  let fixture: ComponentFixture<HierarquiaColaboradoresComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HierarquiaColaboradoresComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HierarquiaColaboradoresComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
